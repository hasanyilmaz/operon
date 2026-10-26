import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type * as Typescript from 'typescript';
import { App, TFile, Notice } from 'obsidian';
import { PreparedTaskCreatorDraft, type PreparedTaskCreatorSubmission } from '../src/ui/task-creator-prepared-draft';
import { prepareCreationCommit } from '../src/core/task-creation-commit';
import { CreationDraftProperties } from '../src/core/task-creation-draft-properties';
import { decodeVaultPropertyValue } from '../src/core/vault-property-codec';
import { parseFrontmatterDocument } from '../src/core/file-task-template-merge';
import { readFileTaskPropertyDocument } from '../src/core/file-task-property-draft';
import { resolveDefaultFileTaskStatus } from '../src/core/file-task-defaults';
import { classifyClassicTaskConversionLine } from '../src/core/classic-task-conversion';
import { convertTasksEmojiLineToOperon } from '../src/core/tasks-emoji-to-operon';
import { applyTasksEmojiConversionToParsedTask } from '../src/core/tasks-emoji-application';
import { tasksConversionProtectedLines } from '../src/core/tasks-conversion-scope';
import { parseTaskLine } from '../src/core/parser';
import { DEFAULT_PRIORITIES } from '../src/types/priority';
import { composeStatusValue, resolveWorkflowStatus } from '../src/types/pipeline';
import { TaskWriter } from '../src/core/task-writer';
import { OperonIndexer } from '../src/indexer/indexer';
import { getNativePropertyIndex } from '../src/indexer/native-property-index';
import { createCachedTableFilePropertyTypeResolver, createVaultFilePropertySnapshot, encodeTableFilePropertyColumnKey } from '../src/ui/table/table-file-property';
import { getTableNativePropertySnapshot, writeTableNativeProperty } from '../src/ui/table/table-native-property';
import { SettingsPreservationHarness } from './test-support/settings-preservation-harness';
import * as rawProperties from '../src/core/raw-yaml-property';
import { encodeVaultPropertyValue } from '../src/core/vault-property-codec';
import { nativePropertyReadOnlyReason } from '../src/core/task-editor-native-properties';

// Execute the production coordinator bodies. Only the Obsidian modal shell and
// filesystem boundary are synthetic; no writer, serializer or index is replaced.
const testRequire = createRequire(`${process.cwd()}/package.json`);
const ts: typeof Typescript = testRequire('typescript');
const { transformSync } = testRequire('esbuild') as typeof import('esbuild');
const source = ts.createSourceFile('main.ts', readFileSync('main.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const plugin = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'OperonPlugin') as Typescript.ClassDeclaration;
function method(name: string, parameters: string, dependencies: Record<string, unknown> = {}, file = 'main.ts', className = 'OperonPlugin') {
 const ast = file === 'main.ts' ? source : ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
 const cls = file === 'main.ts' ? plugin : ast.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text===className) as Typescript.ClassDeclaration;
 const member = cls.members.find(node => node.name?.getText(ast) === name) as Typescript.MethodDeclaration;
 assert.ok(member?.body, name);
 const async = member.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) ? 'async ' : '';
 const code = transformSync(`${async}function invoke(${parameters}) ${member.body.getText(ast)}`, { loader: 'ts' }).code;
 return new Function(...Object.keys(dependencies), `${code};return invoke;`)(...Object.values(dependencies));
}
const emptyDraft = () => ({description:'Task',fieldValues:{},tags:[],note:'',taskIcon:'',taskColor:'',subtaskIds:[],inheritedFieldKeys:[],inheritedTags:[],explicitFieldKeys:[],explicitEmptyFieldKeys:[],fileTemplateId:'',inlineCompletionMode:'keep-completed'});
const types = {Client:'text',Count:'number',Checked:'checkbox',Values:'multitext',Day:'date',Time:'datetime',Blank:'text'} as const;
const template = '---\nClient: hello\nCount: 0\nChecked: false\nValues: [3,"3",Ali,Ali]\nDay: "{{date}}"\nTime: 2026-10-10T12:34:56\nBlank:\n---\nBody {{taskDescription}}';

async function fixture() {
 const disk = new SettingsPreservationHarness({inlinePropertyBackups:true,table:false});
 const storage = disk.createStorage(); await storage.initialize();
 const settings = storage.getSettings();
 const files = new Map<string,TFile>(), contents = new Map<string,string>();
 const reads: string[] = [], writes: string[] = [];
 const notices:string[]=[];
 let ids = 0, failure = '', metadataReads = 0, targetParent = '';
 function seed(path:string, content:string) {
  const file = files.get(path) ?? new (TFile as unknown as new (path:string)=>TFile)(path);
  Object.assign(file,{basename:path.replace(/\.md$/, ''),extension:'md',stat:{mtime:(file.stat?.mtime??0)+1,ctime:1,size:content.length}});
  files.set(path,file); contents.set(path,content); return file;
 }
 const hostFile = seed('Host.md','---\nHost: preserved\n---\n'); seed('Template.md',template);
 const app = {vault:{configDir:'.obsidian',adapter:{...disk.adapter,exists:async(path:string)=>{
  if(path.endsWith('.md')){if(failure==='before-unverified')throw Error('existence unavailable');return failure==='before-existing'||files.has(path);}
  return path.endsWith('types.json') || disk.adapter.exists(path);
 },read:async(path:string)=>{
  if(path.endsWith('types.json')) {metadataReads++; return JSON.stringify({types});}return disk.adapter.read(path);
 }},getMarkdownFiles:()=>[...files.values()].filter(file=>file.path!=='Template.md'),getAbstractFileByPath:(path:string)=>files.get(path)??null,
 read:async(file:TFile)=>{reads.push(file.path);if(failure==='unreadable')throw Error('read unavailable');return contents.get(file.path)!;},
 cachedRead:async(file:TFile)=>{reads.push(file.path);return contents.get(file.path)!;},
 process:async(file:TFile,update:(text:string)=>string)=>{
  if(failure==='before')throw Error('before write');
  const next=update(contents.get(file.path)!);seed(file.path,next);writes.push(file.path);
  if(failure==='lost'){failure='unreadable';throw Error('lost acknowledgement');}if(failure==='after')throw Error('lost acknowledgement');return next;
 },create:async(path:string,content:string)=>{
  if(failure.startsWith('before'))throw Error('before create');assert.ok(!files.has(path));const file=seed(path,content);writes.push(path);if(failure==='after')throw Error('lost acknowledgement');return file;
 },on:()=>({}),offref:()=>{}},metadataCache:{getFileCache:(file:TFile)=>({frontmatter:readFileTaskPropertyDocument(contents.get(file.path)!)?.frontmatter,listItems:[{task:' '}]}),getAllPropertyInfos:()=>({}),on:()=>({}),offref:()=>{}}} as unknown as App;
 const native=getNativePropertyIndex(app);native.configure(settings);native.setTypes(types);
 const indexer=new OperonIndexer(app,{getSettings:()=>settings} as never);
 const writer=new TaskWriter(app,indexer,settings.keyMappings,{getInlinePropertyDefinitions:()=>storage.getCommittedInlinePropertyDefinitions(),prepareInlineProperties:entries=>storage.ensureInlinePropertyDefinitions(entries)});
 const host:any={app,indexer,writer,storage,settings,creatorOpenGeneration:0,preparedCreatorCommits:new WeakMap(),inlineCreatorActiveFiles:new WeakMap(),
  getActiveMarkdownFile:()=>hostFile,getFileTaskTemplateOptionsForPicker:()=>[],taskEditorDeleteOpenViewsMatch:()=>true,syncTaskEditorDeleteOpenViews:()=>true,
  normalizeTaskCreatorText:(value:string)=>value,validateDependencyDraftOrShow:()=>true,getTargetFileTaskFolder:()=>'',ensureFileTaskFolder:async()=>{},
  formatConverter:{getUniqueFilePath:()=>`Created-${ids}.md`},sanitizeTaskFileName:(value:string)=>value,suppressRawTaskCreationNotice:()=>{},fileTaskContentNeedsTemplaterProcessing:(_document:unknown,content:string)=>content.includes('<%'),
  getTemplaterEngine:()=>({parse_template(){},create_running_config(){}}),
  maybeProcessFileTaskTemplaterContent:async(file:TFile,content:string)=>{
   if(failure==='templater-external')seed(file.path,'Concurrent user text');
   return content.replace('<% 42 %>','42').replace('Count: 0','Count: 999').replace('---\n','---\nClient: returned\n');
  },
  loadParsedFrontmatterDocument:async(file:TFile)=>parseFrontmatterDocument(contents.get(file.path)!,settings.keyMappings),
 };
 const t=(_group:string,key:string)=>key;
 host.preparedCreatorLegacyDraft=method('preparedCreatorLegacyDraft','request',{createEmptyTaskCreatorDraft:emptyDraft});
 host.compilePreparedCreator=method('compilePreparedCreator','commit',{prepareCreationCommit,generateOperonId:()=>`s3${String(++ids).padStart(5,'0')}`,localNow:()=> '2026-10-11T10:00:00',resolveWorkflowStatus});
 host.writePreparedCreatorInline=method('writePreparedCreatorInline','draft,file,before,after,canCommit,source');
 host.buildTaskCreatorInlineTaskLine=method('buildTaskCreatorInlineTaskLine','draft,filePath,lineNumber,inherited,now');
 host.createPreparedFileTask=method('createPreparedFileTask','selectedTemplate,options,commit',{TFile,parseFrontmatterDocument,t,Notice});
 let modal:any;
 class ModalBoundary {
  model:PreparedTaskCreatorDraft;
  isCreatorSessionOpen=true; hasDetachedSubmission=false;
  constructor(_app:App,public options:any){this.model=new PreparedTaskCreatorDraft(options.preparedAdapter,settings);modal=this;}
  open(){} onClose(){this.isCreatorSessionOpen=false;this.model.close();} completeAndClose(){this.onClose();}
  refreshPreparedSources(){this.model.refreshParent();}
  acceptPreparedTargetParent(id:string){this.model.backgroundParent(id,null,null);return this.model.submission('inline','Task','keep-completed');}
 }
 const prepare=method('prepareTaskCreator','initialDraft=null,options={}',{getNativePropertyIndex,TaskCreatorModal:ModalBoundary,TFile,CreationDraftProperties,decodeVaultPropertyValue,createCachedTableFilePropertyTypeResolver,createVaultFilePropertySnapshot,resolveDefaultFileTaskStatus,localNow:()=> '2026-10-10T12:34:56',t,Notice:class {constructor(message:string){notices.push(message);}}});
 host.prepareTaskCreator=prepare;
 host.restoreBackgroundTaskCreator=method('restoreBackgroundTaskCreator','');
 host.parseInlineTaskLine=(line:string,lineNumber:number,path:string)=>parseTaskLine(line,lineNumber,path,settings.keyMappings);
 host.getParsedTaskFieldValues=(task:any)=>Object.fromEntries(task.fields.map((field:any)=>[field.key,field.value]));
 host.resolveCheckboxConversionInheritedFields=()=>({});
 host.finalizeTaskCreatorCreatedTask=async()=>{};
 host.refreshViews=()=>{};host.refreshMarkdownAfterInlineAuthoring=()=>{};host.showTaskNotice=()=>{};
 host.openCheckboxConversionCreator=method('openCheckboxConversionCreator','editor,view,lineNumber',{classifyClassicTaskConversionLine,convertTasksEmojiLineToOperon,applyTasksEmojiConversionToParsedTask,tasksConversionProtectedLines,DEFAULT_PRIORITIES,composeStatusValue,createEmptyTaskCreatorDraft:emptyDraft,localNow:()=> '2026-10-11T10:00:00',Notice,t});
 async function conversion(text:string,lineNumber=1) {
  seed('Host.md',text);let buffer=text;
  const editor={getValue:()=>buffer,getLine:(n:number)=>buffer.split('\n')[n]};
  const view={file:hostFile,editor};
  host.syncTaskEditorDeleteOpenViews=(_path:string,_before:string,after:string)=>{buffer=after;return true;};
  host.taskEditorDeleteOpenViewsMatch=(_path:string,expected:string)=>buffer===expected;
  await host.openCheckboxConversionCreator(editor,view,lineNumber);
  return {ui:modal,view,edit:(value:string)=>buffer=value,buffer:()=>buffer};
 }
 async function open(initial=emptyDraft(), overrides: Record<string, unknown> = {}) {
  await prepare.call(host,initial,{
   onSubmitInline:async(draft:any)=>{const content=host.buildTaskCreatorInlineTaskLine(draft,hostFile.path,0,{parentTask:targetParent},'2026-10-11T10:00:00');const before=contents.get(hostFile.path)!;return host.writePreparedCreatorInline(draft,hostFile,before,`${before}${content.taskLine}\n`);},
   onSubmitFile:async(draft:any)=>{const commit=host.preparedCreatorCommits.get(draft);return !!await host.createPreparedFileTask(commit.request.templateOption,{},commit);},
   ...overrides,
  });
  await modal.model.select({id:'template',name:'Template',kind:'folder',path:'Template.md'},'Task');return modal;
 }
 const scan=async(path?:string)=>{settings.inlinePropertyDefinitions=storage.getCommittedInlinePropertyDefinitions();if(path)await indexer.reindexFilePath(path);else await indexer.fullReindex();};
 const snapshot=()=>getTableNativePropertySnapshot({},app,{signature:'base',revision:1,fields:[],getCell:()=>({present:false,rawValue:undefined,normalizedValue:''}),getCandidates:()=>[]},indexer.getAllTasks(),1,settings,()=>{});
 async function editor(id:string) {
  const e:any={app,indexer,settings,filePropertyRoot:{children:[{}],setAttribute(){},removeAttribute(){},querySelector(){return null;},closest(){return null;}},filePropertyGeneration:0,fileProperties:new Map(),submittedFileProperties:new Map(),filePropertyRows:new Map(),
   getCurrentIndexedTask:()=>indexer.getTask(id),filePropertyTypeResolver:createCachedTableFilePropertyTypeResolver(types),renderDesktopFileProperties(){},refreshFilePropertyValue(){},markEdited(){},isNativeCustomProperty:()=>false};
  const deps={...rawProperties,getNativePropertyIndex,nativePropertyReadOnlyReason,encodeVaultPropertyValue,t};
  for(const [name,args] of [['refreshDesktopFileProperties',''],['loadDesktopFileProperties',''],['refreshDesktopPropertyGroupState','container'],['canEditFileProperty','entry'],['setFilePropertyValue','name,value'],['getFilePropertyChanges',''],['getInlinePropertyChanges','']])e[name]=method(name,args,deps,'src/ui/task-editor-content.ts','TaskEditorContent');
  e.nativePropertyField=(name:string,type:string)=>({propertyName:name,type});
  await e.refreshDesktopFileProperties();assert.equal(e.filePropertyUnavailable,false);return e;
 }
 return {conversion,notices,disk,storage,settings,app,native,indexer,writer,host,open,scan,snapshot,editor,contents,reads,writes,seed,metadataReads:()=>metadataReads,failure:(value:string)=>failure=value,targetParent:(value:string)=>targetParent=value,close:async()=>{indexer.destroy();await disk.dispose();}};
}

for(const mode of ['file','inline'] as const)test(`production Creator adapter -> writer/storage -> index -> table: 20 ${mode} cycles`,async()=>{
 const f=await fixture();try{
  for(let i=0;i<20;i++){
   const ui=await f.open();const list=i%5===1?[]:i%5===2?['']:[3,'3','Ali','Ali','a;b','line\nnext'];ui.model.draft.setValue('Values',list);
   const reads=f.reads.length,typesReads=f.metadataReads(),writes=f.writes.length;
   for(let j=0;j<3;j++)ui.model.updateInputs(`Task ${i}-${j}`);
   assert.equal(f.reads.length,reads);assert.equal(f.metadataReads(),typesReads);assert.equal(f.writes.length,writes);
   assert.equal((await ui.options.preparedAdapter.onSubmit(ui.model.submission(mode,`Task ${i}`,'keep-completed'))).outcome,'committed');
   assert.equal(f.writes.length,writes+1);await f.scan();
   const task=f.indexer.getTask(`s3${String(i+1).padStart(5,'0')}`);assert.ok(task);
   const row=f.native.getTask(task);assert.equal(row.available,true);
   const expected=mode==='inline'&&!list.length?undefined:list;
   assert.deepEqual(row.properties.get('values')?.value,expected);assert.equal(row.properties.get('count')?.value,0);assert.equal(row.properties.get('checked')?.value,false);
   assert.equal(row.properties.get('day')?.value,'2026-10-10');assert.equal(row.properties.get('time')?.value,'2026-10-10T12:34:56');assert.equal(row.properties.get('client')?.value,'hello');
   assert.equal(row.properties.get('blank')?.present,mode==='file'?true:undefined);
   const warm=f.reads.length;let cell=f.snapshot().getCell(task,encodeTableFilePropertyColumnKey('Values')!);assert.deepEqual(cell.rawValue,expected);
   const editor=await f.editor(task.operonId);assert.deepEqual(editor.fileProperties.get('Values')?.value,expected);assert.equal(f.reads.length,warm);
   if(i===0){
    editor.setFilePropertyValue('Values',[1,'1','Edited']);
    assert.equal(await f.writer.writeTaskFields(task.operonId,{}, {mode:'merge',reindex:'none',touchAncestors:false,...(mode==='inline'?{inlinePropertyDraft:editor.getInlinePropertyChanges()}:{filePropertyDraft:{changes:editor.getFilePropertyChanges()}})}),true);
    await f.scan(task.primary.filePath);cell=f.snapshot().getCell(f.indexer.getTask(task.operonId)!,encodeTableFilePropertyColumnKey('Values')!);assert.deepEqual(cell.rawValue,[1,'1','Edited']);
    assert.equal(await writeTableNativeProperty(f.app,f.writer,task,{propertyName:'Values',nativeType:'list',sourceFormat:task.primary.format,expected:{present:true,value:cell.rawValue},inlineExpected:cell.inlineExpected,mutation:{kind:'set',value:[0,'0','Ali']}},f.settings,'2026-10-12T12:00:00'),'updated');
    const before=f.reads.length;await f.scan(task.primary.filePath);assert.equal(f.reads.length,before+1);
    assert.deepEqual(f.native.getTask(f.indexer.getTask(task.operonId)!).properties.get('values')?.value,[0,'0','Ali']);
    assert.deepEqual((await f.editor(task.operonId)).fileProperties.get('Values').value,[0,'0','Ali']);
   }
  }
  console.log('CREATION_CHAIN',JSON.stringify({mode,cycles:20,taskWrites:f.writes.length,templateReads:f.reads.filter(path=>path==='Template.md').length,typeReads:f.metadataReads()}));
 }finally{await f.close();}
});

for(const mode of ['inline','file'] as const)for(const failure of mode==='inline'?['before','after','lost']:['before','after','before-unverified','before-existing'])test(`${mode} coordinator handles ${failure} at the real writer boundary`,async()=>{
 const f=await fixture();try{
  const ui=await f.open();const request=ui.model.submission(mode,'Task','keep-completed');f.failure(failure);
  const result=await ui.options.preparedAdapter.onSubmit(request);
  assert.equal(result.outcome,failure==='before'?'failed':failure==='after'?'committed':'uncertain');
  assert.equal(f.writes.length,failure.startsWith('before')?0:1);assert.deepEqual(ui.model.submission(mode,'Task','keep-completed'),request);
 }finally{await f.close();}
});

test('actual modal submit blocks uncertain replay and allows verified pre-write failure retry',async()=>{
 const submit=method('submitPrepared','mode',{Notice,isTaskCreatorCreateTypeAllowed:()=>true,getOwnerWindow:()=>({setTimeout})},'src/ui/task-creator-modal.ts','TaskCreatorModal');
 for(const failure of ['before','lost']){
  const f=await fixture();try{
   const ui=await f.open();let attempts=0;const onSubmit=ui.model.adapter.onSubmit;
   ui.model.adapter.onSubmit=async(request:PreparedTaskCreatorSubmission)=>{attempts++;return onSubmit(request);};
   const shell:any={prepared:ui.model,draft:{description:'Task',inlineCompletionMode:'keep-completed'},submitMode:'both',options:{},containerEl:{},contentEl:{},hideImmediately(){},restoreSubmittedDraft(){this.detachedForSubmit=false;},ensureDescription:()=>true,closeActivePicker(){},closeSuggestions(){},renderSubmitControls(){},forceClose(){}};
   f.failure(failure);await submit.call(shell,'inline');f.failure('');await submit.call(shell,'inline');
   assert.equal(attempts,failure==='lost'?1:2);assert.equal(f.writes.length,1);
  }finally{await f.close();}
 }
});

for(const external of [false,true])test(`controlled File Templater preserves resolved edits and concurrent source: ${external}`,async()=>{
 const f=await fixture();try{
  f.seed('Template.md',template.replace('Client: hello','Client: original\nDynamic: "<% 42 %>"'));
  const ui=await f.open();ui.model.draft.removeField('Client');if(external)f.failure('templater-external');
  const result=await ui.options.preparedAdapter.onSubmit(ui.model.submission('file','Task','keep-completed'));
  assert.equal(result.outcome,external?'uncertain':'committed');
  if(external){assert.equal(f.contents.get('Created-1.md'),'Concurrent user text');assert.equal(f.writes.length,1);}
  else {const doc=readFileTaskPropertyDocument(f.contents.get('Created-1.md')!)!;assert.equal(doc.frontmatter.Client,undefined);assert.equal(doc.frontmatter.Count,0);assert.equal(doc.frontmatter.Dynamic,'42');assert.equal(f.writes.length,2);}
 }finally{await f.close();}
});

test('destination inheritance is applied on first submit without turning fallback priority into a parent value',async()=>{
 const f=await fixture();try{
  f.settings.childTaskInheritanceFields=['contexts','priority'];
  f.seed('Template.md',template.replace('Client: hello','Client: hello\npriority: High'));
  f.seed('Parent.md','---\noperonId: parent1\ncontexts: [parent]\n---\n');await f.scan();
  const ui=await f.open();ui.model.draft.appendMember('contexts','user');f.targetParent('parent1');
  const result=await ui.options.preparedAdapter.onSubmit(ui.model.submission('inline','Task','keep-completed'));
  assert.equal(result.outcome,'committed');assert.equal(f.writes.length,1);await f.scan('Host.md');
  const child=f.indexer.getTask('s300001')!;assert.equal(child.fieldValues.parentTask,'parent1');assert.equal(child.fieldValues.contexts,'user; parent');assert.equal(child.fieldValues.priority,'High');
 }finally{await f.close();}
});

for(const change of ['metadata','closed','deleted-parent','duplicate-parent'])test(`creator rejects ${change} without source writes`,async()=>{
 const f=await fixture();try{
  f.seed('Parent.md','---\noperonId: parent1\ncontexts: [parent]\n---\n');await f.scan();
  const initial=emptyDraft();if(change.includes('parent'))initial.fieldValues={parentTask:'parent1'};
  const ui=await f.open(initial);
  const request=ui.model.submission('inline','Task','keep-completed');
  if(change==='metadata')f.native.setTypes({...types,Count:'text'});
  if(change==='closed')ui.onClose();
  if(change==='deleted-parent'){f.seed('Parent.md','Removed');await f.scan('Parent.md');}
  if(change==='duplicate-parent'){f.seed('Duplicate.md','---\noperonId: parent1\n---');await f.scan('Duplicate.md');}
  const result=await ui.options.preparedAdapter.onSubmit(request);
  assert.notEqual(result.outcome,'committed');assert.equal(f.writes.length,0);
 }finally{await f.close();}
});

test('note selection command: 10 files / 100 tasks use the default template and preserve existing tasks',async()=>{
 const f=await fixture();try{
  const modules=await Promise.all([
   import('../src/core/default-inline-template'),import('../src/core/task-creation-template-session'),import('../src/core/task-creation-draft'),import('../src/core/task-creation-draft-properties'),
   import('../src/core/tasks-emoji-to-operon'),import('../src/core/tasks-emoji-application'),import('../src/core/tasks-conversion-scope'),import('../src/core/markdown-list-items'),import('../src/core/plain-checkbox-lines'),
   import('../src/core/subtask-inheritance'),import('../src/core/serializer'),import('../src/core/parser'),import('../src/core/yaml-fields'),import('../src/core/managed-task-fields'),
   import('../src/types/keys'),import('../src/types/priority'),import('../src/core/task-field-patch'),import('../src/types/pipeline'),import('../src/core/file-task-defaults'),
   import('../src/ui/task-creator-prepared-draft'),import('../src/core/vault-property-codec'),import('../src/core/inline-property-source'),import('../src/core/task-editor-native-properties'),import('../src/core/file-task-auto-parent'),
  ]);
  let ids=0,transactions=0;const notices:string[]=[];
  const deps=Object.assign({},...modules,{getNativePropertyIndex,TFile,localNow:()=> '2026-10-11T12:00:00',generateOperonId:()=>`nt${String(++ids).padStart(5,'0')}`,t:(_group:string,key:string)=>key,Notice:class {constructor(text:string){notices.push(text);}}});
  const names=['loadDefaultInlineTemplate','applyDefaultInlineTemplateToTask','prepareDefaultInlineEditorWrite','inlineTemplateSkippedMessage','handleConvertSelectionToOperonTasksCommand','buildSelectedLineOperonTaskConversion','finalizeBulkConvertedTaskNode','pruneBulkSelectionParentStack','getParsedTaskFieldValues','applyBulkSelectionLineChanges','buildNewInlineTaskWithInheritedFields','applyInheritedSubtaskFields','setParsedTaskField','createInlineField','getInlineWriteKeyName','normalizeParsedTaskCreatedTimestamp','touchParsedTaskModifiedTimestamp','serializeInlineTask','parseInlineTaskLine','resolveCheckboxOwnerInheritedFields','resolveCheckboxConversionInheritedFields'];
  const bodies=names.map(name=>{const member=plugin.members.find(node=>node.name?.getText(source)===name);assert.ok(member,name);return member.getText(source);}).join('\n');
  const code=transformSync(`class Probe {${bodies}}`,{loader:'ts'}).code;
  const Probe=new Function(...Object.keys(deps),`${code};return Probe;`)(...Object.values(deps));
  for(const name of names)f.host[name]=Probe.prototype[name];
  Object.assign(f.host,{getFileTaskTemplateOptions:()=>[{id:'default',name:'Default',kind:'folder',path:'Template.md'}],createRepeatSeriesIdFactory:()=>()=> 'repeat1',resolveInlineTaskInheritedFields:()=>({}),resolveSelectedLineRangeForTaskConversion:()=>({startLine:0,endLine:10}),refreshMarkdownAfterInlineAuthoring(){}});
  f.settings.defaultInlineTaskTemplateId='default';
  for(let n=0;n<10;n++){
   const existing=`- [ ] Existing {{operonId:: ex${String(n).padStart(5,'0')}}}`;
   const before=Array.from({length:10},(_,i)=>`- [ ] Item ${n}-${i} #etiket/çalışma`).concat(existing).join('\n');
   const file=f.seed(`Notes-${n}.md`,before);let text=before;
   const editor={getValue:()=>text,getLine:(i:number)=>text.split('\n')[i]??'',listSelections:()=>[{anchor:{line:0,ch:0},head:{line:10,ch:existing.length}}],transaction:({changes}:any)=>{
    const lines=text.split('\n');for(const change of changes)lines[change.from.line]=change.text;text=lines.join('\n');f.seed(file.path,text);transactions++;
   }};
   await f.host.handleConvertSelectionToOperonTasksCommand(editor,{file,editor},true);
   assert.equal(editor.getLine(10),existing);assert.equal(transactions,n+1);await f.scan(file.path);
   const committed=text;await f.host.handleConvertSelectionToOperonTasksCommand(editor,{file,editor},true);assert.equal(text,committed);assert.equal(transactions,n+1);
  }
  const tasks=f.indexer.getAllTasks().filter(task=>task.operonId.startsWith('nt'));assert.equal(tasks.length,100);
  const warm=f.reads.length;const views=[f.snapshot(),f.snapshot()];
  for(const task of tasks){
   assert.ok(task.tags.includes('etiket/çalışma'));assert.equal(f.native.getTask(task).properties.get('count')?.value,0);
   for(const view of views)assert.deepEqual(view.getCell(task,encodeTableFilePropertyColumnKey('Values')!).rawValue,[3,'3','Ali','Ali']);
  }
  assert.equal(f.reads.length,warm);assert.equal(f.reads.filter(path=>path==='Template.md').length,20,'one read per command, including no-op commands');
  console.log('NOTE_CONVERSION_CHAIN',JSON.stringify({files:10,tasks:100,transactions,templateReads:20,warmReads:0,notices:notices.length}));
 }finally{await f.close();}
});

for(const mode of ['inline','file'] as const)test(`Creator integration learns only verified ${mode} template and next open receives it`,async()=>{
 const f=await fixture();try{
  await f.storage.updateSettings({inlineTaskUseLastTemplateAsDefault:true,fileTaskUseLastTemplateAsDefault:true});
  const ui=await f.open();const key=mode==='inline'?'defaultInlineTaskTemplateId':'taskCreatorDefaultFileTemplateId';
  assert.equal(f.settings[key],null);
  const result=await ui.options.preparedAdapter.onSubmit(ui.model.submission(mode,'Created','keep-completed'));
  assert.equal(result.outcome,'committed');assert.equal(f.settings[key],'template');
  assert.equal(f.settings[mode==='inline'?'taskCreatorDefaultFileTemplateId':'defaultInlineTaskTemplateId'],null);
  const next=await f.open();assert.equal(next.options[mode==='inline'?'defaultInlineTemplateId':'defaultFileTemplateId'],'template');
 }finally{await f.close();}
});
for(const scenario of ['cancel','failed','uncertain','empty','save-error','changed-toggle','changed-default','preview'])test(`Creator learning excludes ${scenario}`,async()=>{
 const f=await fixture();try{
  await f.storage.updateSettings({inlineTaskUseLastTemplateAsDefault:true,defaultInlineTaskTemplateId:'original'});
  const ui=await f.open();
  if(scenario==='cancel'){ui.onClose();assert.equal(f.settings.defaultInlineTaskTemplateId,'original');return;}
  if(scenario==='failed')f.failure('before');
  if(scenario==='uncertain')f.failure('lost');
  if(scenario==='empty')await ui.model.select(null,'Created');
  if(scenario==='save-error')f.storage.saveTaskCreatorTemplateUsage=async()=>{throw Error('settings write failed');};
  if(scenario==='changed-toggle'||scenario==='changed-default'||scenario==='preview'){
   const write=f.host.writePreparedCreatorInline;
   f.host.writePreparedCreatorInline=async(...args:unknown[])=>{
    if(scenario==='changed-toggle')f.settings.inlineTaskUseLastTemplateAsDefault=false;
    else if(scenario==='changed-default')f.settings.defaultInlineTaskTemplateId='manual';
    else {f.host.preparedCreatorCommits.get(args[0]).outcome='preview';return false;}
    return write.apply(f.host,args);
   };
  }
  const result=await ui.options.preparedAdapter.onSubmit(ui.model.submission('inline','Created','keep-completed'));
  assert.equal(result.outcome,scenario==='failed'?'failed':scenario==='uncertain'?'uncertain':scenario==='preview'?'preview':'committed');
  assert.equal(f.settings.defaultInlineTaskTemplateId,scenario==='changed-default'?'manual':'original');
  if(scenario==='save-error'){assert.equal(f.writes.length,1);assert.deepEqual(f.notices,['taskCreatedTemplatePreferencesSaveFailed']);}
 }finally{await f.close();}
});

for (const sourceLine of ['  - [ ] Plain task #source','  - [x] Done task #source','  - [-] Cancelled task #source','  - [ ] 10:00-11:00 Emoji task #source 📅 2026-11-01 ➕ 2026-09-01 🔁 every day']) test(`checkbox Creator replaces one line and retains source: ${sourceLine}`,async()=>{
 const f=await fixture();try {
  f.settings.inlineTaskAfterCreate='editor';let opened='';f.host.captureTaskAfterCreate=()=>async(created:any)=>{assert.ok(f.indexer.getTask(created.operonId));opened=created.operonId;};
  const before=`Header\n${sourceLine}\nFooter`;
  const {ui,buffer}=await f.conversion(before);
  assert.ok(ui);assert.equal(ui.options.submitMode,'inline-only');assert.equal(ui.options.initialCreateType,'inline');
  assert.equal(f.writes.length,0);assert.equal(f.contents.get('Host.md'),before);
  f.seed('Template.md','---\ndateDue: 2030-01-01\ntaskColor: "#00ff00"\n---\n');
  await ui.model.select({id:'template',name:'Template',kind:'folder',path:'Template.md'},ui.options.initialDraft.description);
  const sourceDue=sourceLine.includes('📅');
  const request=ui.model.submission('inline',ui.options.initialDraft.description,'keep-completed');
  assert.equal((await ui.options.preparedAdapter.onSubmit(request)).outcome,'committed');
  const after=f.contents.get('Host.md')!;assert.equal(buffer(),after);assert.equal(after.split('\n').length,3);
  assert.equal(after.split('\n')[0],'Header');assert.equal(after.split('\n')[2],'Footer');assert.ok(after.split('\n')[1].startsWith('  - ['));
  const task=parseTaskLine(after.split('\n')[1],1,'Host.md',f.settings.keyMappings)!;
  assert.equal(opened,task.operonId);
  assert.ok(task.operonId);assert.equal(task.checkbox,sourceLine.includes('[x]')?'done':sourceLine.includes('[-]')?'cancelled':'open');
  assert.ok(task.tags.includes('source'));const fields=Object.fromEntries(task.fields.map(field=>[field.key,field.value]));
  assert.equal(fields.dateDue,sourceDue?'2026-11-01':'2030-01-01');assert.equal(fields.taskColor,'00ff00');
  if(sourceDue){assert.equal(fields.datetimeCreated.slice(0,10),'2026-09-01');assert.equal(task.timePrefix?.startTime,'10:00');assert.ok(fields.repeatSeriesId);}
 }finally{await f.close();}
});
for (const scenario of ['cancel','source-edit','file-switch','disk-edit','failure','uncertain','success']) test(`checkbox Creator guards and template learning: ${scenario}`,async()=>{
 const f=await fixture();try{
  f.settings.inlineTaskAfterCreate='source';let opens=0;f.host.captureTaskAfterCreate=()=>async()=>{opens++;};
  await f.storage.updateSettings({inlineTaskUseLastTemplateAsDefault:true,defaultInlineTaskTemplateId:'original'});
  const before='Header\n- [ ] Original\nFooter';const c=await f.conversion(before);const ui=c.ui;
  await ui.model.select({id:'template',name:'Template',kind:'folder',path:'Template.md'},'Original');
  ui.model.draft.setValue('priority','high');
  if(scenario==='cancel'){ui.completeAndClose();assert.equal(f.writes.length,0);assert.equal(f.contents.get('Host.md'),before);assert.equal(f.settings.defaultInlineTaskTemplateId,'original');return;}
  if(scenario==='source-edit')c.edit(before+'\nUser edit');
  if(scenario==='file-switch')c.view.file=f.seed('Elsewhere.md','Other');
  if(scenario==='disk-edit')f.seed('Host.md',before+'\nExternal edit');
  if(scenario==='failure')f.failure('before');if(scenario==='uncertain')f.failure('lost');
  const result=await ui.options.preparedAdapter.onSubmit(ui.model.submission('inline','Edited description','keep-completed'));
  assert.equal(result.outcome,scenario==='success'?'committed':scenario==='uncertain'?'uncertain':'failed');
  assert.equal(f.settings.defaultInlineTaskTemplateId,scenario==='success'?'template':'original');
  assert.equal(f.writes.length,scenario==='success'||scenario==='uncertain'?1:0);
  assert.equal(opens,scenario==='success'?1:0);
  if(scenario==='success'){assert.match(f.contents.get('Host.md')!,/Edited description/);assert.match(f.contents.get('Host.md')!,/priority:: high/);}
 }finally{await f.close();}
});

for (const enabled of [false,true]) test(`Live Preview conversion toggle routes both icons: ${enabled}`,async()=>{
 let call:Typescript.CallExpression|undefined;
 const visit=(node:Typescript.Node)=>{if(ts.isCallExpression(node)&&node.expression.getText(source)==='operonLivePreviewClassicTaskConvertExtension')call=node;ts.forEachChild(node,visit);};visit(source);assert.ok(call);
 const code=transformSync(`function routes(){return ${call.arguments[0].getText(source)};}`,{loader:'ts'}).code;
 const make=new Function('runAsyncAction',`${code};return routes;`)((_label:string,action:()=>unknown)=>action());
 const events:string[]=[];const view={editor:{}};
 const host={settings:{inlineTaskOpenCreatorBeforeConversion:enabled},getMarkdownViewForEditorView:()=>view,
  openCheckboxConversionCreator:async(editor:unknown,actualView:unknown,line:number)=>{assert.equal(editor,view.editor);assert.equal(actualView,view);events.push(`creator:${line}`);},
  handleConvertTasksEmojiLineToOperonInlineTaskCommand:async()=>events.push('emoji-direct'),upgradePlainCheckboxLineToOperonInlineTask:async()=>events.push('plain-direct')};
 const routes=make.call(host);routes.convertTasksEmojiLine(2,{});routes.upgradePlainCheckboxLine(3,{});
 assert.deepEqual(events,enabled?['creator:2','creator:3']:['emoji-direct','plain-direct']);
});
for (const text of ['```\n- [ ] Protected\n```','Header\n- [ ] Existing {{operonId:: abcdefgh}}\nFooter','Header\nOrdinary paragraph\nFooter']) test(`conversion Creator rejects unsupported sources: ${text.split('\n')[1]}`,async()=>{
 const f=await fixture();try{const c=await f.conversion(text);assert.equal(c.ui,undefined);assert.equal(f.writes.length,0);assert.equal(f.contents.get('Host.md'),text);}finally{await f.close();}
});
test('conversion Creator permits template status and later manual due-date override',async()=>{
 const f=await fixture();try{
  const pipeline=f.settings.pipelines[0];const status=pipeline.statuses.find(item=>!item.isFinished&&!item.isCancelled)!;
  f.seed('Template.md',`---\nstatus: "${composeStatusValue(pipeline.name,status.label)}"\ndateDue: 2030-01-01\n---\n`);
  const {ui}=await f.conversion('Header\n- [ ] Source 📅 2026-11-01\nFooter');
  await ui.model.select({id:'template',name:'Template',kind:'folder',path:'Template.md'},'Source');
  const statusField=ui.model.draft.snapshot().fields.find((field:any)=>field.property.canonicalKey==='status');
  assert.equal(statusField.value,composeStatusValue(pipeline.name,status.label));assert.ok(statusField.contributions.some((entry:any)=>entry.source==='template'));
  ui.model.draft.setValue('dateDue','2027-02-01');
  assert.equal((await ui.options.preparedAdapter.onSubmit(ui.model.submission('inline','Source','keep-completed'))).outcome,'committed');
  assert.match(f.contents.get('Host.md')!,/dateDue:: 2027-02-01/);
 }finally{await f.close();}
});


for (const route of ['generic','file-subtask']) test(`real ${route} coordinator opens after indexing and its callback`,async()=>{
 const f=await fixture();try{
  f.settings.fileTaskAfterCreate='source';const order:string[]=[];
  f.host.captureTaskAfterCreate=()=>async()=>{order.push('open');};
  Object.assign(f.host,{
   createFileTaskFromTemplateSelection:(selected:unknown,options:any)=>f.host.createPreparedFileTask(selected,options,options.prepared),
   resolveTaskCreatorFileTargetFolderOverride:()=>null,
   finalizeCreatedFileTask:async(created:any)=>{await f.scan(created.file.path);order.push('indexed');},
   getCreatedFileTaskForFilterDraft:(created:any)=>f.indexer.getFileTaskByPath(created.file.path),
   prepareSubtaskCreation:async()=>true,
   notifySubtaskCreated:async(callback:any,id:string)=>{await callback?.(id);},
  });
  const name=route==='generic'?'createFileTaskFromCreatorDraft':'createFileSubtaskFromCreatorDraft';
  const create=method(name,route==='generic'?'draft,options':'draft,fallbackFile,onBeforeCreate,onCreated,canCommit,acceptFile',{
   cloneTaskCreatorDraft:structuredClone,buildTaskCreatorSubmitFieldSeed:()=>({fieldValues:{},fieldPresence:new Set(),explicitEmptyFieldKeys:new Set()}),Notice,t:(_ns:string,key:string)=>key,
  });
  const callback=async()=>{order.push('callback');};
  const ui=await f.open(undefined,{onSubmitFile:(draft:any)=>route==='generic'
   ? create.call(f.host,draft,{reopenCreator:()=>{},onCreated:callback})
   : create.call(f.host,draft,null,undefined,callback)});
  assert.equal((await ui.options.preparedAdapter.onSubmit(ui.model.submission('file','Created','keep-completed'))).outcome,'committed');
  assert.deepEqual(order,['indexed','callback','open']);assert.equal(f.writes.length,1);
 }finally{await f.close();}
});
for(const outcome of ['failed','uncertain','unfinalized'])test(`Creator does not open ${outcome} File Task creation`,async()=>{
 const f=await fixture();try{
  f.settings.fileTaskAfterCreate='source';let opens=0;f.host.captureTaskAfterCreate=()=>async()=>{opens++;};
  const ui=await f.open(undefined,{onSubmitFile:async(draft:any)=>{
   const commit=f.host.preparedCreatorCommits.get(draft);commit.outcome=outcome==='unfinalized'?'committed':outcome==='uncertain'?'uncertain':'pending';return outcome==='unfinalized';
  }});
  await ui.options.preparedAdapter.onSubmit(ui.model.submission('file','Created','keep-completed'));assert.equal(opens,0);assert.equal(f.writes.length,0);
 }finally{await f.close();}
});

for (const route of ['generic','subtask'] as const) test(`Inline after-create opens only after real writer, indexing and ${route} callbacks`,async()=>{
 const f=await fixture();try{
  f.settings.inlineTaskAfterCreate='editor';const order:string[]=[];let createdId='';
  f.host.captureTaskAfterCreate=(_anchor:unknown,_generation:number,kind:string)=>async(created:any)=>{assert.equal(kind,'inline');assert.equal(created.operonId,createdId);assert.ok(f.indexer.getTask(created.operonId));order.push('open');};
  f.host.recordInlineTaskCreationTarget=async()=>{};
  f.host.finalizeTaskCreatorCreatedTask=async(id:string)=>{assert.ok(f.indexer.getTask(id));order.push('indexed');};
  f.host.createInlineTaskFromCreatorDraftResult=method('createInlineTaskFromCreatorDraftResult','draft,options={}',{Notice,t:(_ns:string,key:string)=>key});
  f.host.insertTaskCreatorInlineTaskWithResolvedTarget=async(draft:any)=>{
   const file=f.app.vault.getAbstractFileByPath('Host.md') as TFile;const before=f.contents.get(file.path)!;
   const lineNumber=before.split('\n').length-1;const content=f.host.buildTaskCreatorInlineTaskLine(draft,file.path,lineNumber,{},'2026-10-11T10:00:00');createdId=content.operonId;
   if(!await f.host.writePreparedCreatorInline(draft,file,before,`${before}${content.taskLine}\n`))return {kind:'failed'};
   return {kind:'created',result:{operonId:createdId,filePath:file.path,lineNumber}};
  };
  f.host.prepareSubtaskCreation=async()=>true;f.host.notifySubtaskCreated=async(callback:any,id:string)=>callback?.(id);
  const subtask=method('createInlineSubtaskFromFlexibleCreatorDraft','draft,onBeforeCreate,onCreated,canCommit,acceptFile',{Notice,t:(_ns:string,key:string)=>key});
  const callback=async()=>{order.push('callback');};
  const ui=await f.open(undefined,{onSubmitInline:async(draft:any)=>{
   if(route==='subtask')return subtask.call(f.host,draft,undefined,callback);
   const created=await f.host.createInlineTaskFromCreatorDraftResult(draft);if(!created)return false;await callback();return true;
  }});
  assert.equal((await ui.options.preparedAdapter.onSubmit(ui.model.submission('inline','Created','keep-completed'))).outcome,'committed');
  assert.deepEqual(order,['indexed','callback','open']);assert.equal(f.writes.length,1);
 }finally{await f.close();}
});
for(const outcome of ['failed','uncertain','unfinalized'])test(`Creator does not open ${outcome} Inline Task creation`,async()=>{
 const f=await fixture();try{
  f.settings.inlineTaskAfterCreate='editor';let opens=0;f.host.captureTaskAfterCreate=()=>async()=>{opens++;};
  const ui=await f.open(undefined,{onSubmitInline:async(draft:any)=>{
   const commit=f.host.preparedCreatorCommits.get(draft);commit.outcome=outcome==='unfinalized'?'committed':outcome==='uncertain'?'uncertain':'pending';return outcome==='unfinalized';
  }});
  await ui.options.preparedAdapter.onSubmit(ui.model.submission('inline','Created','keep-completed'));assert.equal(opens,0);assert.equal(f.writes.length,0);
 }finally{await f.close();}
});
