import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import ts from 'typescript';

// Exercise the actual Plugin bridge and service with in-memory vault/index boundaries.
const source = ts.createSourceFile('main.ts', await readFile('main.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const plugin = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'OperonPlugin');
const names = ['uiPeriodicNoteRequest', 'resolveEffectivePeriodicNoteConfig', 'resolveEffectiveDailyNoteConfig', 'getPeriodicNoteService',
 'ensurePeriodicNoteContainerRegistered', 'buildPeriodicNoteTemplateRevision', 'resolvePeriodicNoteDeterministicContent', 'resolveOrCreatePeriodicNoteResult',
 'resolveTaskCreatorInlineTargetFile', 'resolvePeriodicNoteFileTaskContainer', 'resolveWeeklyNoteDailyDateHeading', 'insertTaskCreatorInlineTaskUsingDefaultTarget',
 'resolveSpecificFilePlacement', 'resolveInlineTaskSpecificFileHeading', 'resolveInlineTaskTargetFilePath',
 'resolveOrCreateInlineTaskTargetFile', 'resolveAgentRuntimeInlineCreationTarget', 'resolveAgentRuntimeInlineCreationPath',
 'insertTaskCreatorInlineTaskIntoFile', 'handleCreatePeriodicNoteCommand'];
const methods = names.map(name => {
 const method = plugin.members.find(node => node.name?.getText(source) === name);
 assert.ok(method, name);
 return method.getText(source);
}).join('\n');
const input = `
import assert from 'node:assert/strict';
import test from 'node:test';
import moment from 'moment';
import 'moment/locale/de';
import { isValidOperonId } from './src/core/id-generator';
import { PeriodicNoteService } from './src/core/periodic-note-service';
import { resolvePeriodicNoteContainerTask } from './src/core/periodic-note-container';
import { createPeriodicNoteCreatedFileSnapshot, resolvePeriodicNoteContainerRegistrationDisposition, rollbackPeriodicNoteCreatedFileSnapshot } from './src/core/periodic-note-container-registration';
import { resolvePeriodicNoteConfigFromSettings, buildOperonPeriodicNoteConfig } from './src/core/periodic-note-settings';
import { weeklyRowMonday, resolvePeriodicNotePathFromDateKey, formatPeriodicNoteTitleFromDateKey } from './src/core/periodic-note-path';
import { resolveCoreTemplateVariables } from './src/core/core-template-variables';
import { insertInlineTaskUnderHeading, insertInlineTaskUnderFirstHeadingKeyword, UnsafeMarkdownHeadingInsertionError } from './src/core/markdown-heading-insertion';
import { formatDailyNoteTitleFromDateKey } from './src/core/daily-note-path';
import { DEFAULT_SETTINGS, DEFAULT_INLINE_TASK_TARGET_FILE, normalizeSpecificFileHeading, normalizeInlineTaskHeadingKeyword } from './src/types/settings';
const t=(_group,key)=>key, localToday=()=> '2026-10-13', localNow=()=> '2026-10-13T12:00:00';
const isDailyNotesCoreAvailable=app=>app.coreEnabled!==false, loadDailyNotesCoreConfig=app=>app.core;
const loadTemplatesCoreConfig=async()=>({dateFormat:'YYYY-MM-DD',timeFormat:'HH:mm'});
const resolveFileTaskAutoParentOperonId=()=>null, resolveSubtaskInitialFieldsFromParentValues=parentTask=>({parentTask});
const isTaskCreatorFieldExplicitlyCleared=()=>false;
class Notice {constructor(message){}}
class TFile {extension='md';stat={mtime:1,size:0};constructor(public path:string){}}
class Harness {
 workflowNormalizationInProgress=new Set();workflowNormalizationPending=new Set();templatedFileTaskCreationCandidates=new Set();
 ${methods}
}
const seed='---\\nexample: |\\n  ## Tasks\\n---\\n# {{title}}\\n{{date}}\\n\\n~~~md\\n## Tasks\\n~~~\\n\\n## Tasks\\n';
function setup(kind,template,core=false,asTask=false){
 const h:any=new Harness(),files=new Map(),contents=new Map(),events=[];
 const add=(p,content)=>{files.set(p,new TFile(p));contents.set(p,content);};
 add('Templates/Note.md',seed);
 h.settings={...structuredClone(DEFAULT_SETTINGS),manageDailyNotesWithOperon:!core,manageWeeklyNotesWithOperon:true,
  dailyNoteFolder:'Daily',weeklyNoteFolder:'Weekly',dailyNoteFormat:'YYYY/MM-MMMM/YYYY-MM-DD ddd',weeklyNoteFormat:'GGGG-[W]WW',
  dailyNoteTemplate:template,weeklyNoteTemplate:template,createDailyNotesAsOperonTask:asTask,createWeeklyNotesAsOperonTask:asTask,
  inlineTaskHeading:'Tasks',autoParentFileTask:false};
 h.app={core:{folder:'Daily',format:h.settings.dailyNoteFormat,template},metadataCache:{getFileCache:()=>({}),
  getFirstLinkpathDest:(ref)=>[...files.values()].find(f=>f.path.endsWith('/'+ref))},vault:{
  getAbstractFileByPath:p=>files.get(p),cachedRead:async f=>{events.push(['read',f.path]);return contents.get(f.path);},
  create:async(p,content)=>{assert.equal(files.has(p),false);add(p,content);events.push(['create',p]);}},
  workspace:{getLeaf:()=>({openFile:async f=>events.push(['open',f.path])})}};
 h.ensurePeriodicNoteParentDirectories=async()=>{};h.isPeriodicNoteTemplaterAvailable=()=>false;
 h.hasTemplatedFileTaskIdentity=()=>false;h.buildOperonTemplatePlaceholderContext=()=>({});h.resolveOperonTemplatePlaceholdersInContent=c=>c;
 h.resolveTemplatedFileTaskContent=content=>content.replace('---\\n','---\\noperonId: par0001\\n');
 h.loadParsedFrontmatterDocument=async file=>({managedFieldValues:{operonId:contents.get(file.path)?.match(/operonId: (\\w+)/)?.[1]||''},tags:[]});
 h.storage={periodicNoteContainers:{register:async entry=>{events.push(['register',entry]);return {status:'committed'};}}};
 h.indexer={scheduleReindex:p=>events.push(['index',p]),getAllTasks:()=>[]};
 h.indexer.getFileTaskByPath=p=>contents.get(p)?.includes('operonId: par0001')?{operonId:'par0001',primary:{filePath:p},fieldValues:{operonId:'par0001'},tags:[]}:null;
 h.indexer.hasDuplicateOperonIdConflict=()=>false;h.indexer.reindexFilePath=async()=>{};
 h.resolveEffectiveInlineTaskSaveMode=()=>kind+'-notes';
 h.resolveTaskCreatorScheduledPeriodicParent=async()=>({attempted:false});h.isExcalidrawTaskSource=()=>false;
 h.showPeriodicNoteCreationError=(_kind,error)=>events.push(['error',error.code]);
 h.validateDependencyDraftOrShow=()=>true;h.suppressRawTaskCreationNotice=()=>{};
 // Serialization has separate domain tests; the bridge must pass through the selected inline fields.
 h.buildTaskCreatorInlineTaskLine=(draft,_file,_line,inherited)=>{h.inherited=inherited;return {operonId:'new0001',fieldValues:draft.fieldValues,
  taskLine:'- [ ] '+draft.description+' {{priority:: '+draft.fieldValues.priority+'}}'};};
 h.writePreparedCreatorInline=async(_draft,f,before,after,guard)=>{if(!guard())return false;assert.equal(contents.get(f.path),before);contents.set(f.path,after);events.push(['inline',f.path]);return true;};
 return {h,files,contents,events,add};
}
const draft=()=>({description:'Captured',fieldValues:{priority:'A'},tags:[]});
for (const [keyword,coreEnabled,headings,expected] of [
 ['Minor Tasks',true,['~~~','## Minor Tasks','~~~','### My Minor Tasks','## More Minor Tasks'],'### My Minor Tasks'],
 ['New items',true,['# Inbox'],'## New items'],
 ['',true,['# Inbox'],'## [[2026/10/2026-10-13]]'],
 ['',false,['# Inbox'],'## [[2026-10-13]]'],
]) {
 test('Specific File placement in Creator and Runtime: '+expected,async()=>{
  const f=setup('weekly','');
  Object.assign(f.h.settings,{inlineTaskSaveMode:'specific-file',inlineTaskTargetFile:'Inbox.md',inlineTaskHeading:'New Todo',
   inlineTaskSpecificFileHeading:keyword,inlineTaskDailyNoteAddScheduledDate:false});
  f.h.resolveEffectiveInlineTaskSaveMode=()=>f.h.settings.inlineTaskSaveMode;
  f.h.app.coreEnabled=coreEnabled;
  f.h.app.core.format='YYYY/MM/YYYY-MM-DD';
  f.add('Inbox.md',headings.join('\\n')+'\\n');
  const target=await f.h.resolveAgentRuntimeInlineCreationTarget(null);
  assert.deepEqual(target,{filePath:'Inbox.md',placement:keyword?{kind:'under-heading',headingKeyword:keyword}:{kind:'under-exact-heading',heading:expected}});
  for(let i=0;i<2;i++) assert.equal((await f.h.insertTaskCreatorInlineTaskUsingDefaultTarget(draft())).kind,'created');
  const content=f.contents.get('Inbox.md');
  assert.ok(content.includes(expected+'\\n- [ ] Captured'));
  assert.equal(content.split('\\n').filter(line=>line===expected).length,1);
  assert.equal(content.includes('## New Todo'),false);
 });
}
test('Sunday UI routing shares a week across Sunday, Monday and Thursday and across ISO year boundaries',async()=>{
 const f=setup('weekly','Templates/Note');
 f.h.settings.calendarWeekStart='sunday';
 for(const [date,path,anchor] of [
  ['2026-11-22','2026-W48','2026-11-22'],['2026-11-23','2026-W48','2026-11-22'],
  ['2026-11-26','2026-W48','2026-11-22'],['2027-01-02','2026-W53','2026-12-27'],
  ['2027-01-03','2027-W01','2027-01-03']]){
  const result=await f.h.resolveOrCreatePeriodicNoteResult('weekly',date);
  assert.equal(result.file.path,'Weekly/'+path+'.md');
  assert.equal(result.dateKey,anchor);assert.ok(f.contents.get(result.file.path).includes(anchor));
 }
 assert.equal(f.events.filter(e=>e[0]==='create').length,3);
 for(const format of ['GGGGG-[W]WW-W-Wo-GG','ggggg-[w]ww-w-wo-gg']){
  assert.equal(formatPeriodicNoteTitleFromDateKey('weekly','2026-11-22',format,'sunday'),moment('2026-11-23').format(format));
 }
 assert.equal(formatPeriodicNoteTitleFromDateKey('weekly','2027-01-03','YYYY-MM-DD [W]WW GGGG','sunday'),'2027-01-03 W01 2027');
 f.h.settings.weeklyNoteFormat='gggg-[W]ww';
 const local=await f.h.resolveOrCreatePeriodicNoteResult('weekly','2026-12-27');
 assert.equal(local.file.path,'Weekly/'+moment('2026-12-28').format('gggg-[W]ww')+'.md');
});
test('Thursday capture retains its own linked heading and Sunday file-task parent; service callers default to ISO Monday',async()=>{
 const f=setup('weekly','Templates/Note',false,true);
 f.h.settings.calendarWeekStart='sunday';
 f.h.settings.dailyNoteFormat='YYYY-MM-DD';
 const result=await f.h.insertTaskCreatorInlineTaskUsingDefaultTarget(draft(),{targetDateKey:'2026-11-26'});
 assert.equal(result.kind,'created');
 assert.equal(result.result.filePath,'Weekly/2026-W48.md');
 assert.ok(f.contents.get(result.result.filePath).includes('## [[2026-11-26]]\\n- [ ] Captured'));
 assert.equal(f.h.inherited.parentTask,'par0001');
 const resolution=await f.h.resolveEffectivePeriodicNoteConfig('weekly');
 const runtime=await f.h.getPeriodicNoteService().getOrCreate({kind:'weekly',dateKey:'2026-11-22',config:resolution.config});
 assert.equal(runtime.path,'Weekly/2026-W47.md');
 assert.equal(runtime.dateKey,'2026-11-16');
});
test('Sunday File Tasks created by a template retain a stable registry identity with automatic parenting off',async()=>{
 const f=setup('weekly','Templates/Note');
 f.h.settings.weeklyNoteFormat='YYYY-MM-DD';
 f.h.settings.calendarWeekStart='sunday';
 f.h.hasTemplatedFileTaskIdentity=()=>true;
 const result=await f.h.resolveOrCreatePeriodicNoteResult('weekly','2026-11-22');
 assert.equal(result.file.path,'Weekly/2026-11-22.md');
 const [,entry]=f.events.find(event=>event[0]==='register');
 assert.equal(entry.anchorDateKey,'2026-11-23');
 assert.equal(entry.lastKnownPath,result.file.path);
 assert.equal(await f.h.resolvePeriodicNoteFileTaskContainer(result),null);
});
test('date-named UI weeks prefer Sunday and reuse an existing Monday note without rewriting it',async()=>{
 const f=setup('weekly','');f.h.settings.calendarWeekStart='sunday';f.h.settings.weeklyNoteFormat='YYYY-MM-DD';
 const open=date=>f.h.resolveOrCreatePeriodicNoteResult('weekly',date);
 f.add('Weekly/2026-11-23.md','old');
 assert.equal((await open('2026-11-22')).file.path,'Weekly/2026-11-23.md');
 const vanished=await f.h.resolveOrCreatePeriodicNoteResult('weekly','2026-11-22',undefined,()=>{
  f.files.delete('Weekly/2026-11-23.md');return true;
 });
 assert.equal(vanished.file,null);
 assert.equal(f.events.filter(e=>e[0]==='create').length,0);
 f.add('Weekly/2026-11-23.md','old');
 f.add('Weekly/2026-11-22.md','new');
 assert.equal((await open('2026-11-26')).file.path,'Weekly/2026-11-22.md');
 assert.equal(f.contents.get('Weekly/2026-11-23.md'),'old');
 const [sun,mon]=await Promise.all([open('2026-11-29'),open('2026-11-30')]);
 assert.equal(sun.file.path,'Weekly/2026-11-29.md');assert.equal(mon.file.path,sun.file.path);
 assert.equal(f.events.filter(e=>e[0]==='create').length,1);
});
for(const kind of ['daily','weekly'])for(const template of ['','Templates/Note','Templates/Note.md','Note'])for(const core of kind==='daily'?[false,true]:[false]){
 test(kind+' first and next inline creation: '+(template||'no template')+(core?' Core':''),async()=>{
  moment.locale('de');const f=setup(kind,template,core);
  const first=await f.h.insertTaskCreatorInlineTaskUsingDefaultTarget(draft());assert.equal(first.kind,'created');
  const p=first.result.filePath,c=f.contents.get(p);assert.equal(f.events.filter(e=>e[0]==='create').length,1);
  if(template){assert.ok(c.startsWith('---\\nexample: |\\n  ## Tasks\\n---\\n'));assert.ok(c.includes('~~~md\\n## Tasks\\n~~~'));assert.ok(!c.includes('{{title}}'));}
  assert.ok(c.includes('- [ ] Captured {{priority:: A}}'));assert.equal(c.split('\\n')[first.result.lineNumber],'- [ ] Captured {{priority:: A}}');
  if(kind==='weekly')assert.ok(c.includes('## [[2026/10-Oktober/2026-10-13 Di.]]\\n- [ ]'));
  else assert.equal(p,'Daily/2026/10-Oktober/2026-10-13 Di..md');
  f.files.delete('Templates/Note.md');const reads=f.events.filter(e=>e[0]==='read'&&e[1]==='Templates/Note.md').length;
  assert.equal((await f.h.insertTaskCreatorInlineTaskUsingDefaultTarget(draft())).kind,'created');
  assert.equal(f.events.filter(e=>e[0]==='create').length,1);assert.equal(f.events.filter(e=>e[0]==='inline').length,2);
  assert.equal(f.events.filter(e=>e[0]==='read'&&e[1]==='Templates/Note.md').length,reads);
 });
}
for(const kind of ['daily','weekly']){
 test(kind+' first inline creation retains the opt-in periodic File Task parent',async()=>{
  const f=setup(kind,'Note',false,true);const result=await f.h.insertTaskCreatorInlineTaskUsingDefaultTarget(draft());
  assert.equal(result.kind,'created');assert.equal(f.h.inherited.parentTask,'par0001');
  assert.ok(f.contents.get(result.result.filePath).startsWith('---\\noperonId: par0001\\n'));
  assert.equal(f.events.filter(e=>e[0]==='create').length,1);assert.equal(f.events.filter(e=>e[0]==='inline').length,1);
 });
 test(kind+' missing/unsafe template fails without note or inline writes',async()=>{
  for(const ref of ['Missing','../Templates/Note']){const f=setup(kind,ref);assert.equal((await f.h.insertTaskCreatorInlineTaskUsingDefaultTarget(draft())).kind,'failed');
   assert.equal(f.events.filter(e=>e[0]==='create'||e[0]==='inline').length,0);}
 });
 test(kind+' direct command creates only its note; management gate stays intact',async()=>{
  const f=setup(kind,'Note');await f.h.handleCreatePeriodicNoteCommand(kind);
  assert.equal(f.events.filter(e=>e[0]==='create').length,1);assert.equal(f.events.filter(e=>e[0]==='open').length,1);assert.equal(f.events.filter(e=>e[0]==='inline').length,0);
  const disabled=setup(kind,'Note',true);disabled.h.settings.manageWeeklyNotesWithOperon=false;await disabled.h.handleCreatePeriodicNoteCommand(kind);assert.equal(disabled.events.length,0);
 });
 test(kind+' guard denial does not insert; a successfully created note is preserved',async()=>{
  const f=setup(kind,'Note');const result=await f.h.insertTaskCreatorInlineTaskUsingDefaultTarget(draft(),{canCommit:()=>!f.events.some(e=>e[0]==='create')});
  assert.equal(result.kind,'failed');assert.equal(f.events.filter(e=>e[0]==='create').length,1);assert.equal(f.events.filter(e=>e[0]==='inline').length,0);
  const denied=setup(kind,'Note');assert.equal((await denied.h.insertTaskCreatorInlineTaskUsingDefaultTarget(draft(),{canCommit:()=>false})).kind,'failed');assert.equal(denied.events.length,0);
 });
 test(kind+' Mini Calendar cancellation suppresses clean errors but retains recovery notices',async()=>{
  for(const recoveryRequired of [false,true]){
   const f=setup(kind,'');let current=true;
   f.h.getPeriodicNoteService=()=>({prepare:async()=>({status:'prepared',plan:{}}),commit:async()=>{
    current=false;return {ok:false,error:{code:'invalid-target',message:'cancelled',recoveryRequired}};
   }});
   await f.h.resolveOrCreatePeriodicNoteResult(kind,localToday(),undefined,()=>current,undefined,()=>current);
   assert.equal(f.events.filter(e=>e[0]==='error').length,recoveryRequired?1:0);
   assert.equal(f.events.filter(e=>e[0]==='create').length,0);
  }
 });
 test(kind+' unsafe existing heading target stays byte-for-byte unchanged',async()=>{
  const f=setup(kind,'Missing');const resolved=await f.h.resolveEffectivePeriodicNoteConfig(kind);const p=resolvePeriodicNotePathFromDateKey(kind,localToday(),resolved.config);
  for(const original of ['---\\nexample: value','~~~md\\n## Tasks']){f.add(p,original);
   await assert.rejects(f.h.insertTaskCreatorInlineTaskUsingDefaultTarget(draft()),UnsafeMarkdownHeadingInsertionError);assert.equal(f.contents.get(p),original);}
  assert.equal(f.events.filter(e=>e[0]==='create'||e[0]==='inline').length,0);
 });
}
`;
const dir = await mkdtemp(path.join(tmpdir(), 'operon-periodic-first-'));
try {
 const outfile = path.join(dir, 'test.cjs');
 await build({stdin:{contents:input,loader:'ts',resolveDir:process.cwd()},outfile,bundle:true,platform:'node',format:'cjs',logLevel:'silent',plugins:[{
  name:'obsidian',setup(ctx){ctx.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'test'}));ctx.onLoad({filter:/.*/,namespace:'test'},()=>({contents:"export { default as moment } from 'moment';",resolveDir:process.cwd()}));}
 }]});
 const result=spawnSync(process.execPath,['--test',outfile],{stdio:'inherit'});
 if(result.status!==0)process.exitCode=1;
}finally{await rm(dir,{recursive:true,force:true});}
