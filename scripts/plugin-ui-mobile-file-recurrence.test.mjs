import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';

/** Exercise the real Plugin methods and writer with a mobile Vault adapter. */
export async function runMobileFileRecurrenceTests(rootDir) {
 const source = await readFile(path.join(rootDir, 'main.ts'), 'utf8');
 const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
 const plugin = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'OperonPlugin');
 assert.ok(plugin);
 const names = ['updateDirectTaskFieldsAndRefresh', 'isPluginTaskWritePathContained', 'commitFileTerminalRecurrenceMutation', 'runPluginUiTaskMutation', 'getTaskMutationFieldValue', 'markTaskDoneById', 'applyCheckboxStateToFieldPayload', 'updatePluginUiTaskStatusAndRefresh'];
 const methods = names.map(name => {
  const method = plugin.members.find(member => member.name?.getText(ast) === name);
  assert.ok(method, name);
  return method.getText(ast);
 }).join('\n');
 const dir = await mkdtemp(path.join(tmpdir(), 'operon-mobile-file-recurrence-'));
 try {
  const outfile = path.join(dir, 'repro.mjs');
  await build({
   stdin: { resolveDir: rootDir, loader: 'ts', contents: `
import assert from 'node:assert/strict';
import { TFile, TFolder } from 'obsidian';
import { TaskWriter } from './src/core/task-writer';
import { RecurrenceService } from './src/systems/recurrence-service';
import { DEFAULT_SETTINGS } from './src/types/settings';
import { getCheckboxToggleWorkflowStatus } from './src/types/pipeline';
import { isPluginUiMutationCommitted } from './src/systems/plugin-ui-mutation-feedback';
import { validateVaultRelativePathV1 } from './src/agent-runtime/contracts/v1/identity';
import { scanFileWithMappings } from './src/indexer/file-scanner';
import { parseFrontmatterDocument } from './src/core/file-task-template-merge';
import { executeFileRecurrenceTerminalTransaction } from './src/systems/file-recurrence-terminal-transaction';
const Platform = {isDesktop:false,isMobile:true};
const localNow = () => '2026-09-11T12:00:00';
const generateOperonId = () => 'next001';
class Probe { ${methods} }
const original = '---\\noperonId: recur01\\nstatus: task.todo\\nrepeat: mode=done|freq=day|interval=1\\nrepeatSeriesId: series1\\nrepeatOccurrenceDate: 2026-09-10\\ntaskColor: "#9333EA"\\ntaskIcon: lucide-calendar\\n---\\n';
const file = new TFile('Tasks/Repro.md');
file.stat = {mtime:0,ctime:0,size:original.length};
const folder = new TFolder('Tasks'), root = new TFolder('');
const files = new Map(), contents = new Map();
let writes = 0, createConflict = false, sourceConflict = false, ended = false, archived = false, desktopCalls = 0;
function reset() {files.clear(); contents.clear(); files.set(file.path,file); contents.set(file.path,original); writes=0; createConflict=false; sourceConflict=false;}
reset();
const app = {vault:{adapter:{},getAbstractFileByPath:p=>p==='Tasks'?folder:p===''?root:files.get(p)??null,
 read:async f=>contents.get(f.path),
 process:async(f,transform)=>{const before=contents.get(f.path);const after=transform(before);if(after!==before){contents.set(f.path,after);writes++;}return after;},
 create:async(p,c)=>{if(createConflict)throw Error('Injected create failure'); const f=new TFile(p);f.stat={mtime:0,ctime:0,size:c.length};files.set(p,f);contents.set(p,c);writes++;if(sourceConflict)contents.set(file.path,original+'External edit');return f;},
 modify:async(f,c)=>{contents.set(f.path,c);writes++;},
},fileManager:{trashFile:async f=>{files.delete(f.path);contents.delete(f.path);writes++;}}};
const scanned = (await scanFileWithMappings(app,file,[],original)).yamlTask;
assert.ok(scanned);
const task = {...scanned,checkbox:'open',primary:{format:'yaml',filePath:file.path,lineNumber:0}};
const indexer={getTask:id=>id==='recur01'?task:undefined,hasDuplicateOperonIdConflict:()=>false,isPathIndexable:()=>true,handleFileDelete:async()=>{},scheduleReindex:()=>{}};
const probe=new Probe();
Object.assign(probe,{app,indexer,settings:{keyMappings:[]},resolveCompletionTimestamp:localNow,suppressRawTaskCreationNotice:()=>{},isAgentRuntimeMutationPathContained:async()=>{desktopCalls++;return false;}});
probe.writer=new TaskWriter(app,indexer,[],{validateWritePath:(p,a)=>probe.isAgentRuntimeMutationPathContained(p,a),validatePluginWritePath:(p,a)=>probe.isPluginTaskWritePathContained(p,a)});
probe.recurrenceService={ensureFileRecurrenceTargetFolder:async()=>true,planTerminalRecurrenceTransition:()=>ended?{disposition:'series-ended',preview:{seriesId:'series1'}}:{disposition:'materialize-file',preview:{seriesId:'series1',nextOperonId:'next001',nextFilePath:'Tasks/Next.md',plannedSourceContent:original.replace('recur01','next001').replace('2026-09-10','2026-09-11'),coalescedWithPrimarySource:archived,...(archived?{archiveFilePath:'Tasks/Archive.md',archiveSourceContent:original.replace('task.todo','task.done'),nextFilePath:file.path}: {})}}};
let refreshes=0;
probe.schedulePluginUiTaskIndexRefresh=()=>{refreshes++};
for(const reason of ['source-missing','source-changed','series-id-missing']) {
 probe.updateTaskFieldsAndRefresh=async(_id,_payload,options)=>{options.onRecurrenceBlocked(reason);return false};
 assert.equal(await probe.runPluginUiTaskMutation('recur01',{status:'task.done'},{}),reason==='series-id-missing'?'recurrence-blocked':reason);
}
assert.equal(refreshes,2,'Source failures use existing refresh and UI outcomes');
const payload={status:'task.done',_checkbox:'done',dateCompleted:'2026-09-11',datetimeModified:localNow()};
for(const p of ['../Escape.md','/Escape.md','Tasks//Next.md','Missing/Next.md','Tasks/Next.txt','Tasks']) assert.equal(await probe.isPluginTaskWritePathContained(p,true),false,p);
assert.equal(await probe.isPluginTaskWritePathContained('Tasks/Next.md',true),true);
assert.equal(await probe.isPluginTaskWritePathContained('Next.md',true),true);
assert.equal(await probe.isPluginTaskWritePathContained('Tasks/Next.md'),false);
assert.equal(desktopCalls,0);
assert.equal(await probe.writer.taskFieldsMatchCurrentSource('recur01',{status:'task.todo',_checkbox:'open'}),true);
for(const suffix of ['dateCompleted: 2026-09-11','dateCancelled: 2026-09-11']) {
 contents.set(file.path,original.replace('status: task.todo','status: task.todo\\n'+suffix));
 assert.equal(await probe.writer.taskFieldsMatchCurrentSource('recur01',{_checkbox:'open'}),false);
}
reset();
assert.equal(await probe.writer.taskFieldsMatchCurrentSource('recur01',{_checkbox:'done'}),false);
assert.equal((await probe.writer.applyTaskSourceMutation({kind:'modify',filePath:file.path,expectedContent:original,nextContent:original+'changed'})).outcome,'invalid-target');
assert.equal(writes,0);
assert.equal(probe.writer.renderGuardedTaskSourceContent(file.path,original,[{operonId:task.operonId,format:'yaml',fieldValues:payload,expectedFieldValues:task.fieldValues}]).ok,false,'Raw guarded renderer retains exact expectations');
for(const changed of [original.replace('#9333EA','#112233'),original.replace('lucide-calendar','lucide-star'),original.replace('recur01','other01')]) {
 reset();contents.set(file.path,changed);
 const result=await probe.commitFileTerminalRecurrenceMutation(task,payload);
 assert.equal(result.outcome,'blocked');assert.equal(result.reason,'source-changed');
 assert.equal(writes,0);assert.equal(contents.get(file.path),changed);
}
reset();files.delete(file.path);
assert.deepEqual(await probe.commitFileTerminalRecurrenceMutation(task,payload),{outcome:'blocked',reason:'source-missing'});
assert.equal(writes,0);
for(const color of ['"#9333EA"','9333EA','']) for(const icon of ['lucide-calendar','calendar','ri-calendar-line','']) {
 reset();
 const variant=original.replace('"#9333EA"',color).replace('lucide-calendar',icon);
 contents.set(file.path,variant);
 const parsed=(await scanFileWithMappings(app,file,[],variant)).yamlTask;
 const result=await probe.commitFileTerminalRecurrenceMutation({...task,fieldValues:parsed.fieldValues},payload);
 assert.equal(result.outcome,'committed',color+' / '+icon);
 assert.equal(writes,2);assert.equal(files.size,2);
 const again=await probe.commitFileTerminalRecurrenceMutation({...task,fieldValues:parsed.fieldValues},payload);
 assert.equal(again.outcome,'blocked','Stale repeat trigger cannot create a second successor');
 assert.equal(writes,2);
}
const mappedWriter=new TaskWriter(app,indexer,[{canonicalKey:'taskColor',visiblePropertyName:'Color'}]);
assert.equal(mappedWriter.prepareIndexedYamlExpectedFields(original.replace('taskIcon:', 'Color: "#112233"\\ntaskIcon:'),task.fieldValues),null,'Conflicting aliases remain blocked');
for(const value of ['[9333EA]','{color: 9333EA}']) assert.equal(probe.writer.prepareIndexedYamlExpectedFields(original.replace('"#9333EA"',value),task.fieldValues),null,'Non-scalar source remains blocked');
for(const finish of [false,true]) for(const terminal of ['done','cancelled']){
 reset();ended=finish;
 const result=await probe.commitFileTerminalRecurrenceMutation(task,{...payload,status:'task.'+terminal,_checkbox:terminal});
 assert.equal(result.outcome,'committed');
 assert.ok(contents.get(file.path).includes('task.'+terminal));
 assert.equal(files.has('Tasks/Next.md'),!finish);
 assert.equal(writes,finish?1:2);
}
reset();ended=false;archived=true;
assert.equal((await probe.commitFileTerminalRecurrenceMutation(task,payload)).outcome,'committed');
assert.ok(contents.get(file.path).includes('next001'));
assert.ok(contents.get('Tasks/Archive.md').includes('recur01'));
archived=false;
reset();ended=false;sourceConflict=true;
assert.equal((await probe.commitFileTerminalRecurrenceMutation(task,payload)).outcome,'failed');
assert.equal(contents.get(file.path),original+'External edit');
assert.equal(files.has('Tasks/Next.md'),false,'Successor is rolled back without overwriting external edits');
reset();createConflict=true;
await assert.rejects(()=>probe.commitFileTerminalRecurrenceMutation(task,payload),/Injected create failure/);
assert.equal(contents.get(file.path),original);assert.equal(writes,0);

// The context menu supplies a write guard and expected virtual checkbox state.
// Keep the real command, status adapter, writer, recurrence planner and transaction.
// Stub only the surrounding update orchestration (refresh/parent/UI side effects).
probe.settings={...DEFAULT_SETTINGS,keyMappings:[],defaultPipelineName:'task',pipelines:[{id:'task',name:'task',statuses:[
 {id:'todo',label:'todo',isFinished:false,isCancelled:false,isScheduledTarget:false,isTrackingTarget:false,propertyMapping:null},
 {id:'done',label:'done',isFinished:true,isCancelled:false,isScheduledTarget:false,isTrackingTarget:false,propertyMapping:null},
]}]};
probe.recurrenceService=new RecurrenceService(app,indexer,probe.writer,{repeatSeries:{getEntry:()=>null}},()=>probe.settings);
let reportedOutcome, committedResult, plannedTransitions=0, nativeDraft=false;
const realPlan=probe.recurrenceService.planTerminalRecurrenceTransition.bind(probe.recurrenceService);
probe.recurrenceService.planTerminalRecurrenceTransition=input=>{plannedTransitions++;return realPlan(input)};
probe.timeTracker={isTimerRunning:()=>false};
probe.guardTaskStatusChangeOrShow=async()=>true;
probe.buildCalendarRecurrenceFeedbackOptions=()=>({});
probe.showPluginUiMutationOutcome=outcome=>{reportedOutcome=outcome};
probe.updateTaskFieldsAndRefresh=async(id,fields,options)=>{
 assert.equal(id,task.operonId);
 assert.equal(options.expectedFieldValues._checkbox,'open');
 const result=await probe.commitFileTerminalRecurrenceMutation(task,fields,options.onTaskWriteStarted,options);
 if(result.outcome==='not-applicable') {
  options.onTaskWriteStarted();
  const wrote=await probe.writer.writeTaskFields(id,fields,{...options,touchAncestors:false,...(nativeDraft?{filePropertyDraft:{changes:[{propertyName:'ReviewNote',expected:{present:false,value:undefined},value:'checked'}]}}:{})});
  if(wrote)options.onTaskCommitted(fields);
  return wrote;
 }
 committedResult=result;
 if(result.outcome==='blocked')options.onRecurrenceBlocked(result.reason);
 if(result.outcome==='committed')options.onTaskCommitted(fields);
 return result.outcome==='committed';
};
const originalFields={...task.fieldValues};
for(const mode of ['done','schedule']) {
 reset();
 const current=original.replace('mode=done','mode='+mode);
 contents.set(file.path,current);
 task.fieldValues={...(await scanFileWithMappings(app,file,[],current)).yamlTask.fieldValues};
 assert.equal(await probe.markTaskDoneById('recur01',undefined,()=>true),true,'Context menu completes '+mode+' File Task');
 assert.equal(reportedOutcome,'committed');
 assert.equal(writes,2,'One source commit and one successor/archive creation');
 assert.equal(files.size,2);
 assert.equal(committedResult.recurrenceResult.created,true);
 const successorContent=contents.get(committedResult.successor.filePath);
 const successor=(await scanFileWithMappings(app,files.get(committedResult.successor.filePath),[],successorContent)).yamlTask;
 assert.equal(successor.operonId,'next001');
 assert.equal(successor.fieldValues.repeat,task.fieldValues.repeat,'Repeat rule is preserved');
 assert.equal(successor.fieldValues.repeatSeriesId,'series1');
 assert.equal(successor.fieldValues.repeatOccurrenceDate,mode==='done'?'2026-09-12':'2026-09-11','Real recurrence calculation');
 assert.equal(successor.fieldValues.status,'task.todo');
 assert.ok(!successor.fieldValues.dateCompleted);
 const retained=committedResult.writtenFiles.find(entry=>entry.content.includes('recur01'));
 assert.ok(retained);
 const completed=(await scanFileWithMappings(app,files.get(retained.filePath),[],retained.content)).yamlTask;
 assert.equal(completed.fieldValues.status,'task.done');
 assert.equal(completed.fieldValues.dateCompleted,'2026-09-11');
 assert.equal(completed.fieldValues.repeat,task.fieldValues.repeat);
 assert.equal(await probe.markTaskDoneById('recur01',undefined,()=>true),false,'Stale repeat invocation cannot create another task');
 assert.equal(reportedOutcome,'source-changed');
 assert.equal(writes,2);
}
task.fieldValues=originalFields;
for(const change of [
 value=>value.replace('task.todo','task.done'),
 value=>value.replace('status: task.todo','status: task.todo\\ndateCompleted: 2026-09-11'),
 value=>value.replace('status: task.todo','status: task.todo\\ndateCancelled: 2026-09-11'),
 value=>value.replace('interval=1','interval=2'),
 value=>value.replace('#9333EA','#112233'),
]) {
 reset();const changed=change(original);contents.set(file.path,changed);
 const beforePlans=plannedTransitions;
 assert.equal(await probe.markTaskDoneById('recur01',undefined,()=>true),false);
 assert.equal(reportedOutcome,'source-changed');
 assert.equal(plannedTransitions,beforePlans,'Stale files stop before recurrence planning');
 assert.equal(writes,0);assert.equal(files.size,1);assert.equal(contents.get(file.path),changed);
}
reset();
assert.equal(await probe.markTaskDoneById('recur01',undefined,()=>false),false);
assert.equal(writes,0,'Expired context menu cannot write');
for(const expected of [{_checkbox:'done'},{_checkbox:'open',status:'task.done'}]) {
 reset();
 const result=await probe.commitFileTerminalRecurrenceMutation(task,payload,undefined,{expectedFieldValues:expected});
 assert.equal(result.outcome,'blocked');assert.equal(result.reason,'source-changed');assert.equal(writes,0);
}
// An absent terminal field is protected even if the caller only expects checkbox.
for(const key of ['dateCompleted','dateCancelled']) {
 reset();contents.set(file.path,original.replace('status: task.todo','status: task.todo\\n'+key+': 2026-09-11'));
 const result=await probe.commitFileTerminalRecurrenceMutation(task,payload,undefined,{expectedFieldValues:{_checkbox:'open'}});
 assert.equal(result.outcome,'blocked');assert.equal(writes,0);
}

const nonRecurring=original.replace('repeat: mode=done|freq=day|interval=1\\n','');
for(const native of [false,true]) for(const stale of [false,true]) {
 reset();nativeDraft=native;
 task.fieldValues={...(await scanFileWithMappings(app,file,[],nonRecurring)).yamlTask.fieldValues};
 const source=stale?nonRecurring.replace('status: task.todo','status: task.todo\\ndateCompleted: 2026-09-09'):nonRecurring;
 contents.set(file.path,source);
 const beforePlans=plannedTransitions;
 assert.equal(await probe.markTaskDoneById('recur01',undefined,()=>true),!stale,'Non-repeating guarded File Task; native='+native+' stale='+stale);
 assert.equal(reportedOutcome,stale?'source-changed':'committed');
 assert.equal(writes,stale?0:1);assert.equal(files.size,1);assert.equal(plannedTransitions,beforePlans);
 if(stale)assert.equal(contents.get(file.path),source);
 else assert.ok(contents.get(file.path).includes('task.done'));
}
nativeDraft=false;task.fieldValues=originalFields;
assert.equal(probe.writer.prepareIndexedYamlExpectedFields(original,{_checkbox:'open'}),null,'Virtual checkbox requires an indexed File Task basis');
console.log('File context Mark as done: real schedule/done successors, stale fields, duplicate prevention, expired guards and ordinary/native non-repeating writes passed');

Platform.isDesktop=true;Platform.isMobile=false;
assert.equal(await probe.isPluginTaskWritePathContained('Tasks/Next.md',true),false,'Desktop guard still authoritative');
console.log('mobile-file-recurrence: ended and successor commits, source conflict rollback, create failure, feedback and Runtime isolation passed');
` },
   outfile, bundle: true, format: 'esm', platform: 'node', target: ['node18'], logLevel: 'silent',
   alias: { obsidian: path.join(rootDir, 'scripts/test-support/obsidian.ts') },
  });
  await import(pathToFileURL(outfile).href);
 } finally { await rm(dir, {recursive:true, force:true}); }
}
