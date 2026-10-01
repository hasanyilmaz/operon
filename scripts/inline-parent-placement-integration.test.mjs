import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';

export async function runInlineParentPlacementIntegrationTests(rootDir) {
 const source = await readFile(path.join(rootDir, 'main.ts'), 'utf8');
 const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
 const plugin = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'OperonPlugin');
 const names = ['showRawTaskCreationNotices','getFileBasenameFromPath','suppressRawTaskCreationNotice','isRawTaskCreationNoticeSuppressed','pruneRawTaskCreationNoticeSuppressions','showTaskNotice','openInlineTaskEditorForLine','updatePluginUiTaskStatusAndRefresh','runPluginUiTaskMutation','prepareDirectInlineParentPlacement','needsDirectInlineParentPlacement','commitDirectInlineParentPlacement','renderDirectInlineFieldEdit','writeDirectTaskFields','updateDirectTaskFieldsAndRefresh','updateTaskFieldsAndRefresh','parentLinkSourceMatches','parentLinkReplacementPayload','getTaskMutationFieldValue','commitInlineTerminalRecurrenceMutation','applyEditedTaskDirectFromView','replaceInlineTaskLineInContent','updateGanttTaskCascade'];
 const methods = names.map(name => {const method=plugin.members.find(member=>member.name?.getText(ast)===name);assert.ok(method,name);return method.getText(ast);}).join('\n');
 const settingsSource=await readFile(path.join(rootDir,'src/ui/settings-tab.ts'),'utf8');
 const settingsAst=ts.createSourceFile('settings-tab.ts',settingsSource,ts.ScriptTarget.Latest,true);
 const settingsClass=settingsAst.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==='OperonSettingsTab');
 const settingsMethods=['getControlValue','setControlValue'].map(name=>settingsClass.members.find(member=>member.name?.getText(settingsAst)===name).getText(settingsAst)).join('\n');
 assert.match(settingsSource, /inlineTaskParentFileTargetMode === 'inside-parent-file' \|\| this.settings.keepInlineTasksWithParent/);
 assert.match(settingsSource, /'inlineTaskParentFileTargetMode', 'inlineTaskParentFileHeadingKeyword', 'keepInlineTasksWithParent'/);
 const dir=await mkdtemp(path.join(tmpdir(),'operon-inline-parent-integration-'));
 try {
  const outfile=path.join(dir,'test.mjs');
  await build({stdin:{resolveDir:rootDir,loader:'ts',contents: String.raw`
import assert from 'node:assert/strict';
import {TFile} from 'obsidian';
import {TaskWriter} from './src/core/task-writer';
import {formatTaskNotice, formatTaskNoticeCount, buildTaskCreationNotices} from './src/core/task-notice';
const RAW_TASK_CREATION_BULK_NOTICE_THRESHOLD=4,RAW_TASK_CREATION_NOTICE_SUPPRESSION_TTL_MS=30_000;
import {isPluginUiMutationCommitted} from './src/systems/plugin-ui-mutation-feedback';
import {DEFAULT_SETTINGS} from './src/types/settings';
import {OPERON_SETTINGS_SEARCH_REGISTRY} from './src/ui/settings/settings-search-registry';
const isTaskCardSetting=()=>false;
const runAsyncAction=(_label,action)=>action();
import {parseTaskLine} from './src/core/parser';
import {serializeTask} from './src/core/serializer';
import {planInlineTaskParentPlacement} from './src/core/inline-task-parent-placement';
import {commitInlineParentPlacementWrites} from './src/systems/inline-parent-placement-transaction';
import {normalizeRepeatIdentityPayload} from './src/core/repeat-identity';
import {splitFrontmatterDocument, parseFrontmatterDocument} from './src/core/file-task-template-merge';
import {executeTableGanttCascadeTransaction} from './src/ui/table/table-gantt-cascade-transaction';
import {buildTableGanttDescendantShiftPlan} from './src/ui/table/table-gantt-descendant-shift';
const now='2026-09-27T12:00:00';const localNow=()=>now,localToday=()=>now.slice(0,10),enginePerfNow=()=>0;
const generateOperonId=()=> 'next001';
const notices=[];const t=(namespace,key)=>key;class Notice{constructor(message){notices.push(message)}}
const isValidOperonId=id=>!!id;
const resolveStatusMarkdownRefreshScope=()=>undefined;
`+'\nclass Probe {\n'+methods+'\n}\nclass SettingsProbe {\n'+settingsMethods+'\n}\n'+String.raw`
const line=(id,parent='')=>'- [ ] '+id+' {{operonId:: '+id+'}}'+(parent?' {{parentTask:: '+parent+'}}':'');
function fixture(source=line('moving1','parent1')+'\n- [ ] own\n'+line('child01','moving1')+'\n- [x] child check',target=line('parent1')+'\n- [ ] parent check') {
 const disk=new Map([['Source.md',source],['Target.md',target],['Ancestor.md',line('grand01')]]),buffers=new Map(disk),files=new Map([...disk.keys()].map(p=>[p,new TFile(p)]));
 const tasks=new Map(),calls=[],aggregates=[],repairs=[];let failedPath='', external=false, failOnce=false, cycle=false;
 function reindex(){tasks.clear();for(const [p,c] of disk){for(const [i,l]of c.split('\n').entries()){const parsed=parseTaskLine(l,i,p,DEFAULT_SETTINGS.keyMappings);if(parsed?.operonId)tasks.set(parsed.operonId,{...parsed,fieldValues:Object.fromEntries(parsed.fields.map(f=>[f.key,f.value])),primary:{format:'inline',filePath:p,lineNumber:i},tier:'hot',datetimeModified:''});}const doc=parseFrontmatterDocument(c,DEFAULT_SETTINGS.keyMappings);if(doc.managedFieldValues.operonId){const id=doc.managedFieldValues.operonId;tasks.set(id,{operonId:id,description:id,checkbox:'open',tags:[],fieldValues:doc.managedFieldValues,primary:{format:'yaml',filePath:p,lineNumber:0},tier:'hot',datetimeModified:''});}}}
 const app={vault:{getAbstractFileByPath:p=>files.get(p)??null,read:async f=>disk.get(f.path),cachedRead:async f=>disk.get(f.path),process:async(f,cb)=>{if(f.path===failedPath){if(external)disk.set('Target.md','User text');if(failOnce)failedPath='';throw Error('Injected write failure');}const next=cb(disk.get(f.path));calls.push(f.path);disk.set(f.path,next);const movedLine=next.split('\n').find(l=>l.includes('{{operonId:: moving1}}'));if(f.path==='Target.md'&&movedLine){const parsed=parseTaskLine(movedLine,0,f.path,DEFAULT_SETTINGS.keyMappings);probe.showRawTaskCreationNotices([{before:null,after:{...parsed,primary:{format:'inline',filePath:f.path,lineNumber:0}}}]);}return next;}}};
 const indexer={getTask:id=>tasks.get(id),hasDuplicateOperonIdConflict:()=>false,isPathIndexable:()=>true,beginExpectedDuplicateOperonIdTransition:()=>()=>{},reindexFilesBatch:async()=>reindex(),reindexFilePath:async()=>reindex(),forceReindexFilePathAfterMutation:async()=>reindex(),scheduleReindex:()=>{},getAllTasks:()=>[...tasks.values()]};
 const probe=new Probe();Object.assign(probe,{app,indexer,settings:{...DEFAULT_SETTINGS,keepInlineTasksWithParent:true},storage:{repeatSeries:{getAllSeriesIds:()=>[],getEntry:()=>null}},
  wouldCreatePeriodicParentCycle:()=>cycle,persistTaskEditorDeleteOpenSources:async()=>true,
  taskEditorDeleteOpenViewsMatch:(p,c)=>buffers.get(p)===c,syncTaskEditorDeleteOpenViews:(p,b,a)=>{if(buffers.get(p)!==b&&buffers.get(p)!==a)return false;buffers.set(p,a);return true;},
  repairTaskWikilinkOverlayLinks:async o=>repairs.push([...o.operonIds]),refreshViews:()=>{},showPluginUiMutationOutcome:o=>notices.push(o),showTaskEditorMutationOutcome:(r,o)=>notices.push(o),redirectDuplicateOperonIdAction:()=>false,
  inheritFieldsOnParentLink:async(t,p)=>p,applyFieldRulesToTaskPayload:(t,p)=>p,ensureRepeatSeriesIdPayload:()=>{},applyDerivedRepeatFieldsToPayload:async()=>{},validateDependencyPayloadChanges:()=>true,guardTaskStatusChangeOrShow:async()=>true,maybeApplyPeriodicNoteParentRealignmentToPayload:async()=>null,getParentLinkExpectedFields:()=>undefined,
  setStatusCyclePerfChangedKeys:()=>{},logStatusCyclePerfStage:()=>{},commitFileTerminalRecurrenceMutation:async()=>({outcome:'not-applicable'}),createStatusCycleIndexPerfContext:()=>undefined,
  syncDependencyPayloadChanges:async()=>{},syncRepeatSeriesEntryIfNeeded:async()=>{},applyInlineRepeatCompletionModeIfRequested:async()=>{},maybeCreateRecurringOccurrence:async()=>({created:false,reason:'non-recurring'}),resolveAfterTaskForRecurrenceMaterialization:t=>t,
  refreshAggregateTotalsAfterTaskMutation:async(before,after)=>aggregates.push([before.operonId,after?.primary.filePath]),scheduleProjectSerialIndexReconcile:()=>{},
  aggregateCoordinator:{planSameFileStatusCycleAggregate:()=>({eligible:false,fallbackReason:'test'}),refreshAfterTaskMutations:async()=>({failedWriteCount:0})},
  parseInlineTaskLine:(l,i,p)=>parseTaskLine(l,i,p,DEFAULT_SETTINGS.keyMappings),resolveCompletionTimestamp:()=>now,rawTaskCreationNoticeSuppressUntilById:new Map(),showRecurringOccurrenceCreated:()=>{},
  maybeApplyScheduledAutomationToParsedTask:()=>{},applyTaskEditorTimerPayloadToParsedTask:()=>{},applyTaskEditorSaveIntentToPayload:()=>{},preserveAuthoritativeRepeatOccurrenceDate:()=>{},
  buildFieldPayload:p=>({...Object.fromEntries(p.fields.map(f=>[f.key,f.value])),_description:p.description,_checkbox:p.checkbox}),resolveEditorRepeatTemporalScope:async()=>({action:'save',scope:'thisTask',nextSnapshot:null}),
  persistTaskMutationWithFollowingOverride:async(a,b,c,op)=>op(),isPendingRepeatIdentityCommitted:()=>true,taskEditorMutationNoticeRequests:new WeakSet(),pendingGanttTaskWriteIds:new Set(),
 });
 probe.writer=new TaskWriter(app,indexer,DEFAULT_SETTINGS.keyMappings,{validatePluginWritePath:async()=>true,validateWritePath:async()=>false});
 // The existing non-relocating field write is a separate seam. Relocations use the real exclusive writer and exact mutation.
 probe.writer.writeTaskFields=async(id,payload,options)=>{const t=tasks.get(id),before=disk.get(t.primary.filePath);const rendered=probe.writer.renderGuardedTaskSourceContent(t.primary.filePath,before,[{operonId:id,format:t.primary.format,lineNumber:t.primary.lineNumber,fieldValues:payload,expectedFieldValues:options?.expectedFieldValues}]);if(!rendered.ok)return false;const outcome=await probe.writer.applyExactMarkdownSourceMutation(t.primary.filePath,before,rendered.content,options?.canCommit,undefined,'plugin');if(outcome.outcome==='committed')buffers.set(t.primary.filePath,rendered.content);return outcome.outcome==='committed';};
 reindex();notices.length=0;return{probe,disk,buffers,tasks,calls,aggregates,repairs,reindex,fail:(path,userText=false)=>{failedPath=path;external=userText;},cycle:()=>{cycle=true;}};
}
let assertions=0;
const check=(condition,label)=>{assert.ok(condition,label);assertions++;};
// Direct ordinary edit moves exactly one task and its own checkbox; child and ancestor edits stay put.
{
 const f=fixture(undefined,line('parent1','grand01')+'\n- [ ] parent check');
 check(await f.probe.updateDirectTaskFieldsAndRefresh('moving1',{priority:'High'}),'ordinary edit');
 assert.deepEqual(f.calls,['Target.md','Source.md']);
 check(f.tasks.get('moving1').primary.filePath==='Target.md','indexed destination');
 check(f.disk.get('Source.md')===line('child01','moving1')+'\n- [x] child check','child preserved');
 check(f.disk.get('Target.md').indexOf('parent check')<f.disk.get('Target.md').indexOf('moving1'),'after parent checkbox group');
 check(f.disk.get('Target.md').includes('own'),'own checkbox moved');
 check(f.aggregates.length===1,'existing ancestor settlement');
 check(await f.probe.updateTaskFieldsAndRefresh('parent1',{datetimeModified:now}),'derived write');
 check(f.tasks.get('parent1').primary.filePath==='Target.md','derived parent did not follow grandparent');
 check(f.repairs.length===1,'existing link repair invoked once');
 assert.deepEqual(notices,['Inline task moved: moving1']);
 f.probe.showRawTaskCreationNotices([{before:null,after:f.tasks.get('child01')}]);
 assert.deepEqual(notices,['Inline task moved: moving1','Inline task created: child01']);
 assertions+=2;
}
for(const enabled of [false,true]){
 const f=fixture(line('parent1')+'\n## Separate\n'+line('moving1','parent1'), '');f.probe.settings.keepInlineTasksWithParent=enabled;
 check(await f.probe.updateDirectTaskFieldsAndRefresh('moving1',{priority:'High'}),'same-file edit');
 check(f.tasks.get('moving1').primary.lineNumber===2,'same parent does not rearrange');check(notices.length===0,'no move notice for same-parent same-file edit');assert.deepEqual(f.calls,['Source.md']);
}
for(const parent of ['', 'oldpar1']){
 const f=fixture(line('moving1',parent)+'\n- [ ] own\n'+line('parent1')+'\n- [ ] parent check','');
 check(await f.probe.updateDirectTaskFieldsAndRefresh('moving1',{parentTask:'parent1'}),'same-file parent add/change');
 check(f.disk.get('Source.md').indexOf('parent check')<f.disk.get('Source.md').indexOf('moving1'),'reparent placed after owner');assert.deepEqual(notices,['Inline task moved: moving1']);assertions++;assert.deepEqual(f.calls,['Source.md']);
}
for(const enabled of [false,true]){
 const f=fixture();f.probe.settings.keepInlineTasksWithParent=enabled;
 check(await f.probe.updateDirectTaskFieldsAndRefresh('moving1',enabled?{parentTask:''}:{priority:'High'}),'off or parent removed');
 check(f.tasks.get('moving1').primary.filePath==='Source.md','no relocation');
}
{
 const f=fixture(undefined,'---\noperonId: parent1\n---\n# Work\n- [ ] existing\n');f.probe.settings.inlineTaskParentFileHeadingKeyword='Work';
 check(await f.probe.updateDirectTaskFieldsAndRefresh('moving1',{priority:'High'}),'file parent');
 check(f.disk.get('Target.md').indexOf('existing')<f.disk.get('Target.md').indexOf('moving1'),'file parent checkboxes retained');
}
for(const userText of [false,true]){
 const f=fixture(),source=f.disk.get('Source.md'),target=f.disk.get('Target.md');f.fail('Source.md',userText);
 const oldError=console.error;console.error=()=>{};
 try{check(!await f.probe.updateDirectTaskFieldsAndRefresh('moving1',{parentTask:'parent1',priority:'High'}),'failed second write rejected');}finally{console.error=oldError;}
 check(f.disk.get('Source.md')===source,'source unchanged');check(f.disk.get('Target.md')===(userText?'User text':target),'target rollback or preservation');
 assert.deepEqual(notices,[userText?'inlineParentPlacementUncertain':'inlineParentPlacementRolledBack']);assertions++;
}
{
 const f=fixture();f.buffers.set('Target.md','Unsaved user edit');
 check(!await f.probe.updateDirectTaskFieldsAndRefresh('moving1',{priority:'High'}),'divergent editor blocked');check(f.calls.length===0,'no writes');check(notices.includes('inlineParentPlacementBlocked'),'before-write notice');
}
// Pending checkbox edits are rendered before movement and participate in one transaction.
{
 const f=fixture();const before=f.disk.get('Source.md');const task=f.tasks.get('moving1');
 const request={taskLine:line('moving1','parent1')+' {{priority:: High}}',isNew:false,inlineCompletionMode:'keep-completed',fileBody:{filePath:'Source.md',content:before.replace('- [ ] own','- [x] changed own'),expectedContent:before,format:'inline',dirty:true,targetLine:0}};
 check(await f.probe.applyEditedTaskDirectFromView(task,request,{}),'editor save');
 check(f.disk.get('Target.md').includes('- [x] changed own'),'pending own checkboxes moved');
 check(f.disk.get('Source.md').includes('child check'),'child stays');
}
{
 const f=fixture();const before=f.disk.get('Source.md');const task=f.tasks.get('moving1');
 const request={taskLine:line('moving1','parent1'),isNew:false,inlineCompletionMode:'keep-completed',fileBody:{filePath:'Source.md',content:before.replace('own','changed'),expectedContent:before+'stale',format:'inline',dirty:true,targetLine:0}};
 check(await f.probe.applyEditedTaskDirectFromView(task,request,{})===null,'stale body rejected without success reclassification');check(f.calls.length===0,'stale editor zero write');
}
for(const retained of [false,true]){
 const f=fixture(line('moving1','parent1')+' {{repeat:: mode=done|freq=day|interval=1}} {{repeatSeriesId:: series1}}');
 f.probe.recurrenceService={planTerminalRecurrenceTransition:({postTransitionSourceContent})=>({disposition:'materialize-inline',preview:{seriesId:'series1',nextOperonId:'next001',sourceTaskRetained:retained,plannedSourceContent:retained?postTransitionSourceContent+'\n'+line('next001','parent1'):line('next001','parent1')}})};
 check(await f.probe.updateDirectTaskFieldsAndRefresh('moving1',{_checkbox:'done'}),'terminal recurrence');
 check(f.tasks.get('next001').primary.filePath==='Source.md','successor never moved');
 check(retained?f.tasks.get('moving1').primary.filePath==='Target.md':!f.tasks.has('moving1'),'only retained original follows parent');
}
// Guard and lower-level origin boundaries are unchanged by the toggle.
{
 const f=fixture();const source=f.disk.get('Source.md');
 check((await f.probe.writer.applyExactMarkdownSourceMutation('Source.md',source,'replacement')).outcome==='invalid-target','Runtime writer retains own authorization');check(f.calls.length===0,'Runtime cannot acquire plugin origin');
 check(await f.probe.commitDirectInlineParentPlacement(f.tasks.get('moving1'),'parent1',c=>c,{targetId:'other01',placementAttempted:false})===null,'no inherited target authority');
}

for(const failure of [false,true,'setting','heading','cycle']) {
 const f=fixture(line('moving1','parent1')+' {{dateScheduled:: 2026-09-27}}\n'+line('child01','moving1')+' {{dateScheduled:: 2026-09-27}}\n- [ ] child check');
 f.probe.normalizeGanttCascadePayload=(task,payload,time)=>({...payload,datetimeModified:time});
 f.probe.isLatestMaterializedRecurringTask=()=>false;f.probe.buildGanttCascadeRecurrencePlans=async()=>[];
 const source=f.disk.get('Source.md'),target=f.disk.get('Target.md');if(failure===true)f.fail('Source.md');
 if(typeof failure==='string'){const exclusive=f.probe.writer.runExclusiveTaskMutation.bind(f.probe.writer);f.probe.writer.runExclusiveTaskMutation=operation=>{if(failure==='setting')f.probe.settings.keepInlineTasksWithParent=false;if(failure==='heading')f.probe.settings.inlineTaskParentFileHeadingKeyword='Changed';if(failure==='cycle')f.cycle();return exclusive(operation);};}
 const previous=console.error;console.error=()=>{};let outcome;
 try{outcome=await f.probe.updateGanttTaskCascade(f.tasks.get('moving1'),{dateScheduled:'2026-09-28'},1,{directTargetIds:['child01'],downstreamTaskIds:['child01'],hasCycle:false});}finally{console.error=previous;}
 check(!notices.some(n=>n.includes('created')),'cascade never reports creation');
 check(notices.filter(n=>n==='Inline task moved: moving1').length===(failure?0:1),'cascade reports moved only on commit');
 if(failure){check(outcome==='failed-notified','cascade reports rollback');check(f.disk.get('Source.md')===source && f.disk.get('Target.md')===target,'all cascade edits rolled back');}
 else{check(outcome===true,'cascade committed');check(f.tasks.get('moving1').primary.filePath==='Target.md','only explicit cascade root moved');check(f.tasks.get('child01').primary.filePath==='Source.md','derived child kept location');check(f.tasks.get('child01').fieldValues.dateScheduled==='2026-09-28','derived date update preserved');}
}

{
 const settingsProbe=new SettingsProbe();let saved=0,refreshed=0,failure=false;
 Object.assign(settingsProbe,{settings:{...DEFAULT_SETTINGS},findSettingsSearchEntryByKey:key=>OPERON_SETTINGS_SEARCH_REGISTRY.find(e=>e.key===key),
  getRawSettingsSearchValue:key=>settingsProbe.settings[key],normalizeSettingsSearchControlValue:(e,value)=>value===true,
  saveSettings:async()=>{saved++;if(failure)throw Error('settings write failed');},updateNativeSettingsDefinitions:()=>refreshed++});
 check(settingsProbe.getControlValue('keepInlineTasksWithParent')===false,'search default off');
 await settingsProbe.setControlValue('keepInlineTasksWithParent',true);check(settingsProbe.getControlValue('keepInlineTasksWithParent')===true,'search enables');
 check(saved===1&&refreshed===1,'one settings save and definition refresh');failure=true;
 await assert.rejects(settingsProbe.setControlValue('keepInlineTasksWithParent',false));check(settingsProbe.settings.keepInlineTasksWithParent===true,'failed settings save restores preference');
}

for(const failure of [false,true]){
 const f=fixture();let timerRunning=true;if(failure)f.fail('Source.md');
 f.probe.timeTracker={isTimerRunning:()=>timerRunning,stopActiveWithExternalTaskMutation:async(id,time,persist)=>{const saved=await persist({duration:'60'});if(saved)timerRunning=false;return saved?'completed':'task-write-failed';}};
 const old=console.error;console.error=()=>{};let result;try{result=await f.probe.updatePluginUiTaskStatusAndRefresh('moving1',{_checkbox:'done'});}finally{console.error=old;}
 check(isPluginUiMutationCommitted(result)===!failure,'timer-bound status settlement');check(timerRunning===failure,'tracker clears only after committed move');
 if(!failure)check(f.tasks.get('moving1').fieldValues.duration==='60'&&f.tasks.get('moving1').primary.filePath==='Target.md','timer payload moved with original task');
}
{
 const f=fixture();f.probe.maybeApplyPeriodicNoteParentRealignmentToPayload=async(task,payload)=>{payload.parentTask='grand01';};
 check(await f.probe.updateDirectTaskFieldsAndRefresh('moving1',{dateScheduled:'2026-09-28'}),'periodic-parent update');
 check(f.tasks.get('moving1').primary.filePath==='Ancestor.md','final resolved parent used');
}
{
 const f=fixture();check(!await f.probe.writeDirectTaskFields(f.tasks.get('moving1'),{taskColor:'red'},{expectedFieldValues:{taskColor:'old'}}),'raw Canvas stale-field guard');check(f.calls.length===0,'stale field no move');
 check(await f.probe.writeDirectTaskFields(f.tasks.get('moving1'),{taskColor:'red'},{expectedFieldValues:{taskColor:''}}),'raw Canvas direct edit');check(f.tasks.get('moving1').primary.filePath==='Target.md','Canvas direct target moved');
}
{
 const f=fixture();f.probe.indexer.forceReindexFilePathAfterMutation=async()=>{throw Error('post-commit index failure');};
 const prior=console.warn;console.warn=()=>{};let result;
 try{result=await f.probe.applyEditedTaskDirectFromView(f.tasks.get('moving1'),{taskLine:line('moving1','parent1'),inlineCompletionMode:'keep-completed',fileBody:null},{});}finally{console.warn=prior;}
 check(result===true,'post-commit error does not invite replay');check(notices.includes('committed-repair-scheduled'),'repair notice follows verified commit');
}

// Exercise the editor-line adapter itself, including an already-positioned same-file reparent.
for(const sameFile of [false,true]){
 const source=sameFile?line('parent1')+'\n    '+line('moving1'):line('moving1','parent1');
 const f=fixture(source,sameFile?'':line('parent1'));let callback,editorWrites=0;
 const editor={getValue:()=>f.buffers.get('Source.md'),getLine:n=>f.buffers.get('Source.md').split('\n')[n],setLine(){editorWrites++;},setCursor(){}};
 const startLine=sameFile?1:0;
 Object.assign(f.probe,{openTaskEditorFor:async(_task,save)=>{callback=save;},getMarkdownViewsForPath:()=>[{editor}],persistMarkdownViewBuffer:async()=>{},getFrontmatterLineCount:()=>0,placeCursorAfterInlineTaskDescription:()=>{},applyEditedTaskFromView:(task,request)=>f.probe.applyEditedTaskDirectFromView(task,request,{})});
 f.probe.openInlineTaskEditorForLine(editor,'Source.md',startLine,f.tasks.get('moving1'));
 const request={taskLine:(sameFile?'    ':'')+line('moving1','parent1'),fileBody:null};
 check(await callback(request),'editor-line adapter saves eligible existing inline task');
 check(editorWrites===0,'adapter never restores stale captured source line');
 check(f.tasks.get('moving1').fieldValues.parentTask==='parent1','committed parent retained');
 if(!sameFile)check(f.tasks.get('moving1').primary.filePath==='Target.md','adapter moves cross-file');
}
{
 const f=fixture();await f.probe.updateDirectTaskFieldsAndRefresh('moving1',{priority:'High'});const before=[...f.disk];
 const request={taskLine:line('moving1','parent1'),fileBody:{filePath:'Source.md',format:'inline',dirty:true,content:line('moving1','parent1')+'\nUser draft',expectedContent:''}};
 check(await f.probe.applyEditedTaskDirectFromView(f.tasks.get('moving1'),request,{})===null,'stale whole-file draft rejected after relocation');
 assert.deepEqual([...f.disk],before);
}
console.log('inline-parent-placement integration: '+assertions+' checks passed with production methods and exact writer');
`},outfile,bundle:true,format:'esm',platform:'node',target:['node18'],logLevel:'silent',alias:{obsidian:path.join(rootDir,'scripts/test-support/obsidian.ts')}});
  await import(pathToFileURL(outfile).href);
 } finally{await rm(dir,{recursive:true,force:true});}
}
