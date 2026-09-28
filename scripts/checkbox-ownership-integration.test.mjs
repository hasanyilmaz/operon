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
 const names = ['prepareAgentRuntimeSourceTransition','normalizeMovedInlineTaskPlainCheckboxLines','getCommonLeadingWhitespace','getCommonPrefix','prependMovedPlainCheckboxLinesToFileTaskContent','getFrontmatterLineCount','prepareAgentRuntimeTaskAdoption','findInlineTaskLineIndex','resolveCheckboxOwnerInheritedFields','resolveCheckboxConversionInheritedFields','handleConvertSelectionToOperonTasksCommand','resolveSelectedLineRangeForTaskConversion','normalizeEditorSelection','isMarkdownFenceLine','buildSelectedLineOperonTaskConversion','finalizeBulkConvertedTaskNode','pruneBulkSelectionParentStack','getParsedTaskFieldValues','applyBulkSelectionLineChanges','buildNewInlineTaskWithInheritedFields','applyInheritedSubtaskFields','setParsedTaskField','createInlineField','getInlineWriteKeyName','normalizeParsedTaskCreatedTimestamp','touchParsedTaskModifiedTimestamp','serializeInlineTask','parseInlineTaskLine','upgradePlainCheckboxLineToOperonInlineTask','handleConvertTasksEmojiLineToOperonInlineTaskCommand','evaluateAgentRuntimeSavedFilter','applyUiCanonicalConversion','insertTaskCreatorInlineTaskBelowInlineParent'];
 const methods = names.map(name=>{const method=plugin.members.find(member=>member.name?.getText(ast)===name);assert.ok(method,name);return method.getText(ast);}).join('\n');
 const bar = plugin.members.find(member=>member.name?.getText(ast)==='registerInlineTaskBar');
 let openEditor;
 function find(node) { if(ts.isPropertyAssignment(node)&&node.name.getText(ast)==='openEditor') openEditor ??= node.initializer.getText(ast); ts.forEachChild(node,find); }
 find(bar); assert.ok(openEditor);
 let checkboxCommand;
 function findCheckboxCommand(node) {
  if(ts.isObjectLiteralExpression(node)&&node.properties.some(p=>ts.isPropertyAssignment(p)&&p.name.getText(ast)==='id'&&ts.isStringLiteral(p.initializer)&&p.initializer.text==='convert-checkboxes-in-selection-to-tasks')) checkboxCommand=node.getText(ast);
  ts.forEachChild(node,findCheckboxCommand);
 }
 findCheckboxCommand(ast);assert.ok(checkboxCommand);
 const dir=await mkdtemp(path.join(tmpdir(),'operon-checkbox-integration-'));
 try {
  const outfile=path.join(dir,'probe.mjs');
  await build({stdin:{resolveDir:rootDir,loader:'ts',contents:String.raw`
import assert from 'node:assert/strict';
import {TFile,TFolder,Platform} from 'obsidian';
import {conversionPreparationFailure} from './src/systems/plugin-ui-conversion-transaction';
import {EditorState} from '@codemirror/state';
import {splitFrontmatterDocument} from './src/core/file-task-template-merge';
import {iterateMarkdownLinesOutsideFences} from './src/core/markdown-fenced-lines';
import {guardRuntimeInlineRelocationV1} from './src/agent-runtime/runtime/source-transition-guards';
import {buildRuntimeConversionAncestorPredictedEffectsV1} from './src/agent-runtime/runtime/task-mutation-adapter';
import {compareResourceReferencesCanonicalV1} from './src/agent-runtime/contracts/v1/identity';
import {findFileTaskTemplateOptionById} from './src/core/file-task-templates';
import {resolveWorkflowStatus} from './src/types/pipeline';
import {TaskWriter} from './src/core/task-writer';
import {scanFileWithMappings} from './src/indexer/file-scanner';
import {sourceRevisionForTaskCreationV1} from './src/agent-runtime/runtime/task-creation-adapter';
import {canonicalJsonV1,toJsonValueV1,sha256HexV1} from './src/agent-runtime/contracts/v1/canonical';
import {boundRuntimeTransactionIdV1} from './src/agent-runtime/runtime/transaction-identifiers';
import {toLocalDatetime} from './src/core/local-time';
import {composeStatusValue} from './src/core/workflow-status-value';
import {DEFAULT_SETTINGS} from './src/types/settings';
import {DEFAULT_PRIORITIES} from './src/types/priority';
import {collectScopedPlainCheckboxMoveLines,removePlainCheckboxMoveLinesFromContent,scanPlainCheckboxOwnership} from './src/core/plain-checkbox-lines';
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
`+'\nclass Probe {\n'+methods+'\ngetOpenEditor(){return '+openEditor+';}\ngetCheckboxCommand(){return '+checkboxCommand+';}\n}\n'+String.raw`
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
 const f=fixture('- Note\n- [ ] Convert',0,1),command=f.probe.getCheckboxCommand();
 assert.equal(command.id,'convert-checkboxes-in-selection-to-tasks');
 assert.equal(command.name.key,'convertCheckboxesInSelectionToOperonTasks');
 assert.equal(command.hotkeys,undefined);
 command.editorCallback(f.editor,f.view);
 assert.equal(f.editor.getLine(0),'- Note');assert.ok(fields(f.probe,f.editor.getLine(1)).operonId);checks+=5;
}

// Exercise both commands through production conversion and ownership methods.
for (const checkboxesOnly of [false, true]) {
 const lines=['# Project','- Context','- [ ] First','  - Explanation','  - [ ] Child','1. Numbered note','- [x] Done','* [-] Cancelled','+ [ ] Plus','- [/] Custom','','~~~md','- [ ] Code','~~~','Paragraph'];
 const f=fixture(lines.join('\n'),0,lines.length-1);
 await f.probe.handleConvertSelectionToOperonTasksCommand(f.editor,f.view,checkboxesOnly);
 const expected=checkboxesOnly?[2,4,6,7,8,9]:[1,2,3,4,5,6,7,8,9];
 for(let i=0;i<lines.length;i++) {
  if(expected.includes(i)) assert.ok(fields(f.probe,f.editor.getLine(i),i).operonId);
  else assert.equal(f.editor.getLine(i),lines[i]);
 }
 const first=fields(f.probe,f.editor.getLine(2),2),child=fields(f.probe,f.editor.getLine(4),4);
 assert.equal(child.parentTask,first.operonId);
 assert.equal(f.probe.parseInlineTaskLine(f.editor.getLine(6),6,'Tasks.md').checkbox,'done');
 assert.equal(f.probe.parseInlineTaskLine(f.editor.getLine(7),7,'Tasks.md').checkbox,'cancelled');
 assert.match(fields(f.probe,f.editor.getLine(9)).note,/custom checkbox symbol: \//);
 const output=f.editor.getValue();
 let transactions=0;f.editor.transaction=()=>{transactions++};
 await f.probe.handleConvertSelectionToOperonTasksCommand(f.editor,f.view,checkboxesOnly);
 assert.equal(transactions,0);assert.equal(f.editor.getValue(),output);checks+=21;
}
for (const separator of ['', '   ', '# Boundary', 'Plain text', '- Explanation']) {
 const lines=[parent,'- [ ] Collect','- [ ] Review','\t- [ ] Fix',separator,'\t- [ ] Detached'];
 const f=fixture(lines.join('\n'),1,5);
 await f.probe.handleConvertSelectionToOperonTasksCommand(f.editor,f.view,true);
 assert.equal(fields(f.probe,f.editor.getLine(1)).parentTask,'parent1');
 assert.equal(fields(f.probe,f.editor.getLine(2)).parentTask,'parent1');
 assert.equal(fields(f.probe,f.editor.getLine(3)).parentTask,fields(f.probe,f.editor.getLine(2)).operonId);
 assert.equal(fields(f.probe,f.editor.getLine(5)).parentTask,'file001');
 assert.equal(f.editor.getLine(4),separator);assert.ok(f.editor.getLine(3).startsWith('\t- '));checks+=6;
}
{
 const f=fixture(parent+'\n- [ ] Unselected\n  - [ ] Selected\n\n- [ ] Other',2,2);
 await f.probe.handleConvertSelectionToOperonTasksCommand(f.editor,f.view,true);
 assert.equal(fields(f.probe,f.editor.getLine(2)).parentTask,'parent1');
 assert.equal(f.editor.getLine(0),parent);assert.equal(f.editor.getLine(1),'- [ ] Unselected');checks+=3;
}
{
 const lines=['- [ ] Existing {{operonId:: exist01}}','  - [ ] Child','- [ ] New 📅 2026-10-01'];
 const f=fixture(lines.join('\n'),0,2);
 await f.probe.handleConvertSelectionToOperonTasksCommand(f.editor,f.view,true);
 assert.equal(f.editor.getLine(0),lines[0]);assert.equal(fields(f.probe,f.editor.getLine(1)).parentTask,'exist01');
 assert.equal(fields(f.probe,f.editor.getLine(2)).dateDue,'2026-10-01');checks+=3;
}
{
 const lines=['- [ ] Valid','1. [ ] Unsupported numbered checkbox','> - [ ] Quoted checkbox','- [ ] Has fields {{priority:: A}}'];
 const f=fixture(lines.join('\n'),0,3);
 await f.probe.handleConvertSelectionToOperonTasksCommand(f.editor,f.view,true);
 assert.ok(fields(f.probe,f.editor.getLine(0)).operonId);
 for(let i=1;i<lines.length;i++)assert.equal(f.editor.getLine(i),lines[i]);checks+=4;
}
// Actual selection resolver: partial lines, reversed selection and end-at-next-line.
for (const reversed of [false,true]) {
 const f=fixture('- Context\n- [ ] Selected\n- [ ] Outside',0,2);
 delete f.probe.resolveSelectedLineRangeForTaskConversion;
 const from={line:1,ch:4},to={line:2,ch:0};
 Object.assign(f.editor,{somethingSelected:()=>true,listSelections:()=>[{anchor:reversed?to:from,head:reversed?from:to}]});
 await f.probe.handleConvertSelectionToOperonTasksCommand(f.editor,f.view,true);
 assert.ok(fields(f.probe,f.editor.getLine(1)).operonId,'partial selection: '+f.editor.getValue());assert.equal(f.editor.getLine(2),'- [ ] Outside');checks+=2;
}
for(const mode of ['empty','multiple','no-checkbox']) {
 const content='- Note\n1. Numbered\n# Heading',f=fixture(content,0,2);let writes=0;
 f.editor.transaction=()=>{writes++};f.editor.setLine=()=>{writes++};
 delete f.probe.resolveSelectedLineRangeForTaskConversion;
 const selection={anchor:{line:0,ch:0},head:{line:2,ch:9}};
 Object.assign(f.editor,{somethingSelected:()=>mode!=='empty',listSelections:()=>mode==='multiple'?[selection,selection]:[selection]});
 await f.probe.handleConvertSelectionToOperonTasksCommand(f.editor,f.view,true);
 assert.equal(writes,0);assert.equal(f.editor.getValue(),content);
 assert.equal(notices.at(-1).key,mode==='empty'?'convertCheckboxesInSelectionSelectCheckboxes':mode==='multiple'?'convertSelectionToOperonTasksSingleSelection':'convertCheckboxesInSelectionNoItems');checks+=3;
}
{
 // CodeMirror normalizes CRLF input into document lines; exercise that real boundary.
 let state=EditorState.create({doc:'- Context\r\n- [ ] Convert\r\nParagraph\r\n'});
 const f=fixture(state.sliceDoc(),1,1);
 Object.assign(f.editor,{
  getValue:()=>state.sliceDoc(),getLine:i=>state.doc.line(i+1).text,
  transaction:({changes})=>{state=state.update({changes:changes.map(c=>({from:state.doc.line(c.from.line+1).from+c.from.ch,to:state.doc.line(c.to.line+1).from+c.to.ch,insert:c.text}))}).state;},
 });
 await f.probe.handleConvertSelectionToOperonTasksCommand(f.editor,f.view,true);
 assert.equal(f.editor.getLine(0),'- Context');assert.equal(f.editor.getLine(2),'Paragraph');assert.equal(f.editor.getLine(3),'');
 assert.ok(fields(f.probe,f.editor.getLine(1)).operonId);checks+=4;
}
{
 const content='~~~md\n- [ ] Code\n~~~\n- [ ] Real',f=fixture(content,1,3);
 delete f.probe.isMarkdownFenceLine;
 await f.probe.handleConvertSelectionToOperonTasksCommand(f.editor,f.view,true);
 assert.equal(f.editor.getLine(1),'- [ ] Code');assert.ok(fields(f.probe,f.editor.getLine(3)).operonId);checks+=2;
}
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
for(const indent of ['', '\t', '    ']) {
 const f=fixture(parent+'\n'+indent+'- [ ] Review 📅 2026-10-01');
 await f.probe.handleConvertTasksEmojiLineToOperonInlineTaskCommand(f.editor,f.view,1);
 const row=fields(f.probe,f.editor.getLine(1));assert.equal(row.parentTask,'parent1');assert.equal(row.dateDue,'2026-10-01');assert.equal(/^[ \t]*/u.exec(f.editor.getLine(1))[0],indent);checks+=3;
}
{
 const f=fixture(''),filter={id:'filter1',name:'Open checks',rootGroup:{id:'root',logic:'all',children:[{id:'checks',field:'__plainCheckboxes',fieldType:'checkbox',operator:'hasOpen'}]},sorts:[],matchLogic:'all',conditions:[]}, task={operonId:'parent1',description:'Parent',fieldValues:{},checkbox:'open',tags:[],tier:'hot',datetimeModified:'',primary:{filePath:'Tasks.md',lineNumber:0,format:'inline'},plainCheckboxProgress:{total:1,completed:1},legacyPlainCheckboxProgress:{total:2,completed:1}};
 f.probe.settings.filterSets=[filter];f.probe.indexer={getAllTasks:()=>[task]};f.probe.getTableFilePropertySnapshot=()=>undefined;
 assert.equal(evaluateFilterSet(filter,[task],f.probe.settings.priorities,null,f.probe.settings.pipelines).length,0);
 const result=f.probe.evaluateAgentRuntimeSavedFilter({filterSetId:'filter1'});assert.equal(result.ok,true);assert.equal(result.tasks.length,1);assert.deepEqual(task.plainCheckboxProgress,{total:1,completed:1});checks+=4;
}
{
 const f=fixture(''),policies=[];Platform.isMobile=false;f.probe.app={vault:{getAbstractFileByPath:()=>null}};
 const task={operonId:'parent1',primary:{format:'inline',filePath:'Tasks.md',lineNumber:0}};
 f.probe.persistTaskEditorDeleteOpenSources=async()=>true;f.probe.indexer={getTask:()=>task,reindexFilesBatch:async()=>{},hasDuplicateOperonIdConflict:()=>false};
 f.probe.agentRuntimeTaskLocator=()=>({representation:'inline',filePath:'Tasks.md',lineNumber:0});
 f.probe.taskEditorDeleteOpenViewsMatch=()=>true;f.probe.refreshUiConversionViews=async()=>true;
 f.probe.previewAgentRuntimeMutation=async(_request,_context,policy)=>{policies.push(policy);return {ok:true,plan:{requiresConfirmation:false,requiredAcknowledgements:[],affectedResources:[],conversionEffect:{afterLocator:{filePath:'Target.md',representation:'file'}}}}};
 f.probe.applyAgentRuntimeMutation=async(_request,policy)=>{policies.push(policy);return {status:'applied'}};
 assert.equal((await f.probe.applyUiCanonicalConversion(task,{operation:'convert',from:'inline',to:'file',targetPath:'Target.md'})).status,'committed');
 assert.deepEqual(policies.map(policy=>policy.checkboxOwnership),['contiguous','contiguous']);assert.equal(typeof policies[1].conversionSources.canWrite,'function');checks+=3;
}
for(const trailing of ['', '\n']) {
 const f=fixture(parent+'\n        - [ ] Last'+trailing), callbacks=[];
 f.probe.indexer={getTask:()=>({operonId:'parent1',primary:{filePath:'Tasks.md',lineNumber:0,format:'inline'}})};
 f.probe.getMarkdownViewForEditorView=()=>f.view;f.probe.openTaskEditorFor=async(_task,save)=>callbacks.push(save);f.probe.persistInlineEditorBufferAndReindex=async()=>{};f.probe.recordInlineTaskCreationFromEditor=async()=>{};f.probe.recordInlineTaskCreationTarget=async()=>{};
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

for(const indent of ['\t', '    ']) {
for(const separator of ['\n','\r\n']) {
 for(const boundary of ['', ' ', '# Heading','Text','- [ ] Candidate {{priority:: A}}']) {
  const owned = boundary === '';
  const rows=owned?[parent,indent+'- [ ] Child','- [ ] Following']:[parent,boundary,indent+'- [ ] Child','- [ ] Following'];
  const f=fixture(rows.join(separator)),line=owned?1:2;
  f.probe.settings.autoParentFileTask=false;
  f.probe.indexer={getTaskSnapshot:()=>null,hasDuplicateOperonIdConflict:()=>false};
  f.probe.readAgentRuntimeMutationSource=async()=>({content:f.editor.getValue()});
  f.probe.writer=new TaskWriter({},f.probe.indexer,f.probe.settings.keyMappings);
  const intent={operation:'adopt-inline',source:{filePath:'Tasks.md',lineNumber:line,expectedLine:rows[line]}};
  const legacy=await f.probe.prepareAgentRuntimeTaskAdoption(intent,'2026-09-27T12:00:00.000Z');
  const next=await f.probe.prepareAgentRuntimeTaskAdoption(intent,'2026-09-27T12:00:00.000Z',true);
  assert.equal(legacy.ok,true,JSON.stringify(legacy));assert.equal(next.ok,true,JSON.stringify(next));
  assert.equal(fields(f.probe,legacy.value.sealedSpec.resultingLine).parentTask,undefined);
  assert.equal(fields(f.probe,next.value.sealedSpec.resultingLine).parentTask,owned?'parent1':undefined);
  assert.equal(/^[ \t]*/u.exec(next.value.sealedSpec.resultingLine)[0],indent);
  assert.equal(next.value.sealedSpec.locator.lineNumber,line);
  assert.equal(next.value.token.afterContent.split(separator).at(-1),'- [ ] Following');
  if(owned)assert.ok(fields(f.probe,next.value.token.afterContent.split(separator)[0]).datetimeModified);
  assert.equal(f.editor.getValue(),rows.join(separator),'preview never writes');checks+=8;
 }
}
}
for(const autoParent of [true,false]) {
 const rows=['---','operonId: file001','---','','- [ ] Detached'],f=fixture(rows.join('\n'));
 f.probe.settings.autoParentFileTask=autoParent;f.file.stat={mtime:0,size:0};f.file.basename='Tasks';
 f.probe.indexer={getTaskSnapshot:()=>null,hasDuplicateOperonIdConflict:()=>false};
 f.probe.app={vault:{getAbstractFileByPath:()=>f.file}};
 f.probe.readAgentRuntimeMutationSource=async()=>({content:f.editor.getValue()});
 f.probe.writer=new TaskWriter(f.probe.app,f.probe.indexer,f.probe.settings.keyMappings);
 const result=await f.probe.prepareAgentRuntimeTaskAdoption({operation:'adopt-inline',source:{filePath:'Tasks.md',lineNumber:4,expectedLine:rows[4]}},'2026-09-27T12:00:00.000Z',true);
 assert.ok(result.ok,JSON.stringify(result));
 const child=fields(f.probe,result.value.sealedSpec.resultingLine);assert.equal(child.parentTask,autoParent?'file001':undefined);
 assert.equal(result.value.token.afterContent.split('\n')[result.value.sealedSpec.locator.lineNumber],result.value.sealedSpec.resultingLine);checks+=3;
}
{
 const f=fixture(''),filter={id:'filter1',name:'Open checks',rootGroup:{id:'root',logic:'all',children:[{id:'checks',field:'__plainCheckboxes',fieldType:'checkbox',operator:'hasOpen'}]},sorts:[],matchLogic:'all',conditions:[]},task={operonId:'parent1',description:'Parent',fieldValues:{},checkbox:'open',tags:[],tier:'hot',datetimeModified:'',primary:{filePath:'Tasks.md',lineNumber:0,format:'inline'},plainCheckboxProgress:{total:1,completed:1},legacyPlainCheckboxProgress:{total:2,completed:1}};
 f.probe.settings.filterSets=[filter];f.probe.indexer={getAllTasks:()=>[task]};f.probe.getTableFilePropertySnapshot=()=>undefined;
 const old=f.probe.evaluateAgentRuntimeSavedFilter({filterSetId:'filter1'}),next=f.probe.evaluateAgentRuntimeSavedFilter({filterSetId:'filter1'},true);
 assert.equal(old.tasks.length,1);assert.equal(next.tasks.length,0);assert.notEqual(old.queryDigest,next.queryDigest);checks+=3;
}

{
 const content=parent+'\n- [x] Completed',f=fixture(content);f.probe.settings.autoParentFileTask=false;
 f.probe.indexer={getTaskSnapshot:()=>null,hasDuplicateOperonIdConflict:()=>false};f.probe.readAgentRuntimeMutationSource=async()=>({content});f.probe.writer=new TaskWriter({},f.probe.indexer,f.probe.settings.keyMappings);
 const intent={operation:'adopt-inline',source:{filePath:'Tasks.md',lineNumber:1,expectedLine:'- [x] Completed'},terminalSourcePolicy:'reopen'};
 const initial=f.probe.resolveCheckboxOwnerInheritedFields(content,'Tasks.md',{operonId:'parent1',lineNumber:0});
 const result=await f.probe.prepareAgentRuntimeTaskAdoption(intent,'2026-09-27T12:00:00.000Z',true);assert.ok(result.ok,JSON.stringify(result));assert.equal(fields(f.probe,result.value.sealedSpec.resultingLine).status,initial.status);checks+=2;
 const explicit=f.probe.settings.pipelines.flatMap(p=>p.statuses).find(s=>!s.isFinished&&!s.isCancelled&& !initial.status?.endsWith(s.label));
 assert.ok(explicit);{const chosen=await f.probe.prepareAgentRuntimeTaskAdoption({...intent,statusId:explicit.id},'2026-09-27T12:00:00.000Z',true);assert.ok(chosen.ok,JSON.stringify(chosen));assert.ok(fields(f.probe,chosen.value.sealedSpec.resultingLine).status.endsWith(explicit.label));checks+=2;}
}
for(const content of ['~~~\n- [ ] Example\n~~~','---\n- [ ] Example\n---']) {
 const f=fixture(content);f.probe.indexer={getTaskSnapshot:()=>null,hasDuplicateOperonIdConflict:()=>false};f.probe.readAgentRuntimeMutationSource=async()=>({content});
 const result=await f.probe.prepareAgentRuntimeTaskAdoption({operation:'adopt-inline',source:{filePath:'Tasks.md',lineNumber:1,expectedLine:'- [ ] Example'}},'2026-09-27T12:00:00.000Z',true);assert.equal(result.ok,false);assert.equal(result.code,'invalid-request');checks+=2;
}
for(const attached of [true,false]) {
 const content=parent+(attached?'\n  - [ ] Own':'')+'\n\n- [ ] Detached', f=fixture(content);
 const locator={representation:'inline',filePath:'Tasks.md',lineNumber:0},task={operonId:'parent1',description:'Parent',checkbox:'open',fieldValues:{operonId:'parent1'},tags:[],primary:{format:'inline',filePath:'Tasks.md',lineNumber:0}};
 f.probe.indexer={getTaskSnapshot:()=>task,hasDuplicateOperonIdConflict:()=>false};f.probe.agentRuntimeTaskLocator=()=>locator;
 f.probe.readAgentRuntimeMutationSource=async path=>({content:path==='Tasks.md'?content:'# Destination\n\n'});
 const request={target:{operonId:'parent1',locator},spec:{operation:'relocate-inline',destination:{locator:{representation:'inline',filePath:'Target.md',lineNumber:1},mustBeBlank:true}}};
 const old=await f.probe.prepareAgentRuntimeSourceTransition(request,'2026-09-27T12:00:00.000Z');
 const next=await f.probe.prepareAgentRuntimeSourceTransition(request,'2026-09-27T12:00:00.000Z',{checkboxOwnership:'contiguous'});
 assert.ok(old.ok,JSON.stringify(old));assert.ok(next.ok,JSON.stringify(next));
 assert.equal(old.value.requiredAcknowledgements.length,1);assert.equal(next.value.requiredAcknowledgements?.length??0,attached?1:0);
 assert.equal(next.value.token.groups[1].nextContent,content.replace(parent,''));
 assert.equal(next.value.token.groups[0].nextContent,'# Destination\n'+parent+'\n');checks+=6;
 f.probe.settings.inlineToFileTaskMovePlainCheckboxes=true;
 f.probe.app={vault:{getAbstractFileByPath:()=>null}};
 f.probe.getFileTaskTemplateOptions=()=>[{id:'test-template',kind:'file',label:'Fixture',filePath:'Template.md'}];
 f.probe.readAgentRuntimeCreationTemplate=async()=>({revision:{algorithm:'sha256',contentDigest:sha256HexV1('Template')}});
 f.probe.loadFileTaskTemplateDocumentFromOption=async()=>({});f.probe.buildParsedTaskFieldValues=()=>task.fieldValues;
 f.probe.buildLinkedFileTaskSeed=async()=>({fieldValues:task.fieldValues,fieldPresence:new Set(['operonId']),tags:[]});
 f.probe.resolveLoadedFileTaskTemplateDocument=()=>({});f.probe.buildOperonTemplatePlaceholderContext=()=>({});
 f.probe.buildFileTaskDraft=()=>({operonId:'parent1',fieldValues:task.fieldValues,tags:[],content:'---\noperonId: parent1\n---\nFile body'});
 f.probe.fileTaskContentNeedsTemplaterProcessing=()=>false;f.probe.getTargetFileTaskFolder=()=>'';f.probe.sanitizeTaskFileName=()=> 'Parent';
 f.probe.resolveFileTaskTemplatePlaceholdersInContent=text=>text;f.probe.escapeFileTaskWikilinkTarget=text=>text;f.probe.getAgentRuntimeSettingsFingerprint=()=> 'settings';
 const conversion={target:request.target,spec:{operation:'convert',from:'inline',to:'file',templateId:'test-template',targetPath:'Converted.md'}};
 const legacy=await f.probe.prepareAgentRuntimeSourceTransition(conversion,'2026-09-27T12:00:00.000Z');
 const contiguous=await f.probe.prepareAgentRuntimeSourceTransition(conversion,'2026-09-27T12:00:00.000Z',{checkboxOwnership:'contiguous'});
 assert.ok(legacy.ok,JSON.stringify(legacy));assert.ok(contiguous.ok,JSON.stringify(contiguous));
 assert.equal(legacy.value.conversionEffect.checkboxCarryoverCount,attached?2:1);assert.equal(contiguous.value.conversionEffect.checkboxCarryoverCount??0,attached?1:0);
 assert.ok(contiguous.value.token.groups[1].nextContent.includes('- [ ] Detached'));assert.ok(!contiguous.value.token.groups[0].nextContent.includes('Detached'));
 assert.equal(f.editor.getValue(),content);checks+=7;
}
console.log('Checkbox ownership Plugin integration: '+checks+' checks passed with production methods.');
`},outfile,bundle:true,format:'esm',platform:'node',target:['node18'],logLevel:'silent',alias:{obsidian:path.join(rootDir,'scripts/test-support/obsidian.ts')}});
  await import(pathToFileURL(outfile).href);
 } finally { await rm(dir,{recursive:true,force:true}); }
}
