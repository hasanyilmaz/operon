import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';

export async function runCheckboxOwnershipIntegrationTests(rootDir) {
 const source = await readFile(path.join(rootDir, 'main.ts'), 'utf8');
 const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
 const plugin = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'OperonPlugin');
 const names = ['resolveCheckboxOwnerInheritedFields','resolveCheckboxConversionInheritedFields','handleConvertSelectionToOperonTasksCommand','buildSelectedLineOperonTaskConversion','finalizeBulkConvertedTaskNode','pruneBulkSelectionParentStack','getParsedTaskFieldValues','applyBulkSelectionLineChanges','buildNewInlineTaskWithInheritedFields','applyInheritedSubtaskFields','setParsedTaskField','createInlineField','getInlineWriteKeyName','normalizeParsedTaskCreatedTimestamp','touchParsedTaskModifiedTimestamp','serializeInlineTask','parseInlineTaskLine','upgradePlainCheckboxLineToOperonInlineTask','handleConvertTasksEmojiLineToOperonInlineTaskCommand','evaluateAgentRuntimeSavedFilter','applyUiCanonicalConversion','insertTaskCreatorInlineTaskBelowInlineParent'];
 const methods = names.map(name=>{const method=plugin.members.find(member=>member.name?.getText(ast)===name);assert.ok(method,name);return method.getText(ast);}).join('\n');
 const bar = plugin.members.find(member=>member.name?.getText(ast)==='registerInlineTaskBar');
 let openEditor;
 function find(node) { if(ts.isPropertyAssignment(node)&&node.name.getText(ast)==='openEditor') openEditor ??= node.initializer.getText(ast); ts.forEachChild(node,find); }
 find(bar); assert.ok(openEditor);
 const dir=await mkdtemp(path.join(tmpdir(),'operon-checkbox-integration-'));
 try {
  const outfile=path.join(dir,'probe.mjs');
  await build({stdin:{resolveDir:rootDir,loader:'ts',contents:String.raw`
import assert from 'node:assert/strict';
import {TFile,TFolder,Platform} from 'obsidian';
import {DEFAULT_SETTINGS} from './src/types/settings';
import {DEFAULT_PRIORITIES} from './src/types/priority';
import {scanPlainCheckboxOwnership} from './src/core/plain-checkbox-lines';
import {parseTaskLine,hasOperonFields} from './src/core/parser';
import {serializeTask} from './src/core/serializer';
import {normalizeLegacyCreatedDatetime} from './src/core/yaml-fields';
import {getManagedTaskFieldType} from './src/core/managed-task-fields';
import {isValidOperonId} from './src/core/id-generator';
import {getSubtaskInitialFieldKeys,resolveSubtaskInitialFieldsFromParentValues} from './src/core/subtask-inheritance';
import {extractMarkdownCheckboxListItem,extractMarkdownListItemDescription,measureMarkdownIndent,normalizeMarkdownCheckboxMarker} from './src/core/markdown-list-items';
import {convertTasksEmojiLineToOperon} from './src/core/tasks-emoji-to-operon';
import {applyTasksEmojiConversionToParsedTask} from './src/core/tasks-emoji-application';
import {evaluateFilterSet} from './src/core/filter-evaluator';
import {resolveInlineParentCheckboxPlacement,indentNewInlineSubtask} from './src/core/task-creator-target-resolver';
const localNow=()=> '2026-09-27T12:00:00'; let nextId=0;
const generateOperonId=()=> 'test'+String(++nextId).padStart(3,'0');
const notices=[]; const t=(_namespace,key,values)=>({key,...values}); class Notice{constructor(message){notices.push(message)}}
const getActiveWindow=()=>({crypto:globalThis.crypto}); const runAsyncAction=(_label,action)=>action();
const savedFilterQueryDigestV1=()=> 'digest'; const createScopedMarkdownRefreshScope=()=>undefined;
`+'\nclass Probe {\n'+methods+'\ngetOpenEditor(){return '+openEditor+';}\n}\n'+String.raw`
function editorFixture(content) {
 let text=content;
 return {getValue:()=>text,getLine:i=>text.split('\n')[i]??'',setLine:(i,l)=>{const rows=text.split('\n');rows[i]=l;text=rows.join('\n')},transaction:({changes})=>{const rows=text.split('\n');for(const change of changes)rows[change.from.line]=change.text;text=rows.join('\n')},replaceRange:(value,from,to)=>{const rows=text.split('\n');const offset=p=>{const line=Math.min(p.line,rows.length-1);return rows.slice(0,line).reduce((n,l)=>n+l.length+1,0)+Math.min(p.ch,rows[line].length)};const start=offset(from),end=offset(to);text=text.slice(0,start)+value+text.slice(end)},getCursor:()=>({line:1,ch:0})};
}
function fixture(content,start=1,end=3) {
 const probe=new Probe(),editor=editorFixture(content),file=new TFile('Tasks.md');
 Object.assign(probe,{settings:{...DEFAULT_SETTINGS},resolveSelectedLineRangeForTaskConversion:()=>({startLine:start,endLine:end}),resolveInlineTaskInheritedFields:()=>({parentTask:'file001'}),createRepeatSeriesIdFactory:()=>()=> 'repeat1',isMarkdownFenceLine:l=>/^\s*(?:~~~|`+'`'.repeat(3)+String.raw`)/u.test(l),refreshMarkdownAfterInlineAuthoring:()=>{},suppressRawTaskCreationNotice:()=>{},placeCursorAfterInlineTaskDescription:()=>{},showTaskNotice:()=>{}});
 return {probe,editor,file,view:{file,editor}};
}
const parent='- [ ] Parent {{operonId:: parent1}}';
const fields=(probe,line,i=0)=>probe.getParsedTaskFieldValues(probe.parseInlineTaskLine(line,i,'Tasks.md'));
let checks=0;
{
 const f=fixture(parent+'\n- [ ] Collect\n- [ ] Review\n    - [ ] Fix\n\n- [ ] Detached');
 await f.probe.handleConvertSelectionToOperonTasksCommand(f.editor,f.view);
 const rows=f.editor.getValue().split('\n'),a=fields(f.probe,rows[1]),b=fields(f.probe,rows[2]),c=fields(f.probe,rows[3]);
 assert.equal(a.parentTask,'parent1');assert.equal(b.parentTask,'parent1');assert.equal(c.parentTask,b.operonId);assert.equal(rows[4],'');assert.equal(rows[5],'- [ ] Detached');assert.equal(notices.at(-1).linked,'3');checks+=6;
}
{
 const f=fixture(parent+'\n- [ ] Unselected\n    - [ ] Selected\n\n- [ ] Detached',2,2);
 await f.probe.handleConvertSelectionToOperonTasksCommand(f.editor,f.view);
 assert.equal(fields(f.probe,f.editor.getLine(2)).parentTask,'parent1');assert.equal(f.editor.getLine(1),'- [ ] Unselected');checks+=2;
}
{
 const f=fixture(parent+'\n- [ ] First\n\n    - [ ] Detached\n- [ ] Next {{operonId:: parent2}}\n- [ ] Last',1,5);
 await f.probe.handleConvertSelectionToOperonTasksCommand(f.editor,f.view);
 assert.equal(fields(f.probe,f.editor.getLine(1)).parentTask,'parent1');assert.equal(fields(f.probe,f.editor.getLine(3)).parentTask,'file001');assert.equal(fields(f.probe,f.editor.getLine(5)).parentTask,'parent2');assert.equal(f.editor.getLine(4),'- [ ] Next {{operonId:: parent2}}');checks+=4;
}
{
 const f=fixture(parent+'\n- [ ] Review\n    - [x] Fix\n\n- [ ] Detached');
 f.probe.settings.autoParentFileTask=false;
 f.probe.upgradePlainCheckboxLineToOperonInlineTask(f.editor,f.view,1);
 const row=fields(f.probe,f.editor.getLine(1));assert.equal(row.parentTask,'parent1');
 assert.equal(scanPlainCheckboxOwnership(f.editor.getValue(),'Tasks.md',f.probe.settings.keyMappings,'contiguous').checkboxes[0].owner.operonId,row.operonId);
 f.probe.upgradePlainCheckboxLineToOperonInlineTask(f.editor,f.view,4);assert.equal(fields(f.probe,f.editor.getLine(4)).parentTask,'file001');checks+=3;
}
{
 const f=fixture(parent+'\n- [ ] Review 📅 2026-10-01');
 await f.probe.handleConvertTasksEmojiLineToOperonInlineTaskCommand(f.editor,f.view,1);
 const row=fields(f.probe,f.editor.getLine(1));assert.equal(row.parentTask,'parent1');assert.equal(row.dateDue,'2026-10-01');checks+=2;
}
{
 const f=fixture(''),filter={id:'filter1',name:'Open checks',rootGroup:{id:'root',logic:'all',children:[{id:'checks',field:'__plainCheckboxes',fieldType:'checkbox',operator:'hasOpen'}]},sorts:[],matchLogic:'all',conditions:[]}, task={operonId:'parent1',description:'Parent',fieldValues:{},checkbox:'open',tags:[],tier:'hot',datetimeModified:'',primary:{filePath:'Tasks.md',lineNumber:0,format:'inline'},plainCheckboxProgress:{total:1,completed:1},legacyPlainCheckboxProgress:{total:2,completed:1}};
 f.probe.settings.filterSets=[filter];f.probe.indexer={getAllTasks:()=>[task]};f.probe.getTableFilePropertySnapshot=()=>undefined;
 assert.equal(evaluateFilterSet(filter,[task],f.probe.settings.priorities,null,f.probe.settings.pipelines).length,0);
 const result=f.probe.evaluateAgentRuntimeSavedFilter({filterSetId:'filter1'});assert.equal(result.ok,true);assert.equal(result.tasks.length,1);assert.deepEqual(task.plainCheckboxProgress,{total:1,completed:1});checks+=4;
}
{
 const f=fixture(''),policies=[];Platform.isMobile=false;
 f.probe.previewAgentRuntimeMutation=async(_request,_context,policy)=>{policies.push(policy);return {ok:true,plan:{requiresConfirmation:false,requiredAcknowledgements:[],affectedResources:[]}}};
 f.probe.applyAgentRuntimeMutation=async(_request,policy)=>{policies.push(policy);return {status:'applied'}};f.probe.refreshViews=()=>{};f.probe.refreshMarkdownTaskSurfaces=()=>{};
 assert.deepEqual(await f.probe.applyUiCanonicalConversion({operonId:'parent1',primary:{format:'inline',filePath:'Tasks.md',lineNumber:0}},{operation:'convert',from:'inline',to:'file'}),{handled:true,success:true});
 assert.deepEqual(policies,[{checkboxOwnership:'contiguous'},{checkboxOwnership:'contiguous'}]);checks+=2;
}
for(const trailing of ['', '\n']) {
 const f=fixture(parent+'\n        - [ ] Last'+trailing), callbacks=[];
 f.probe.indexer={getTask:()=>({operonId:'parent1',primary:{filePath:'Tasks.md',lineNumber:0,format:'inline'}})};
 f.probe.getMarkdownViewForEditorView=()=>f.view;f.probe.openTaskEditorFor=async(_task,save)=>callbacks.push(save);f.probe.persistInlineEditorBufferAndReindex=async()=>{};
 f.probe.getOpenEditor()(f.probe.parseInlineTaskLine(parent,0,'Tasks.md'),{});
 await callbacks[0]({isNew:true,taskLine:'- [ ] Child {{operonId:: child01}}'});
 assert.equal(f.editor.getLine(1),'        - [ ] Last');assert.equal(f.editor.getLine(2),'    - [ ] Child {{operonId:: child01}}');checks+=2;
}
{
 const f=fixture(parent+'\n        - [ ] Last'),task={operonId:'parent1',primary:{filePath:'Tasks.md',lineNumber:99,format:'inline'}};
 let written;f.probe.app={vault:{getAbstractFileByPath:()=>f.file,cachedRead:async()=>f.editor.getValue(),modify:async(_file,content)=>written=content}};f.file.extension='md';
 f.probe.buildTaskCreatorInlineTaskLine=()=>({operonId:'child01',taskLine:'- [ ] Child {{operonId:: child01}}',fieldValues:{}});f.probe.validateDependencyDraftOrShow=()=>true;
 const result=await f.probe.insertTaskCreatorInlineTaskBelowInlineParent({},task);
 assert.equal(result.lineNumber,2);assert.equal(written,parent+'\n        - [ ] Last\n    - [ ] Child {{operonId:: child01}}');checks+=2;
}
console.log('Checkbox ownership Plugin integration: '+checks+' checks passed with production methods.');
`},outfile,bundle:true,format:'esm',platform:'node',target:['node18'],logLevel:'silent',alias:{obsidian:path.join(rootDir,'scripts/test-support/obsidian.ts')}});
  await import(pathToFileURL(outfile).href);
 } finally { await rm(dir,{recursive:true,force:true}); }
}
