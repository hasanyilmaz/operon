import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import ts from 'typescript';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=await build({stdin:{contents:"export {SettingsWritesSuspendedError} from './src/storage/operon-data-package-store';",resolveDir:root},bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});
const {SettingsWritesSuspendedError}=await import('data:text/javascript;base64,'+Buffer.from(runtime.outputFiles[0].text).toString('base64'));
const source=readFileSync(path.join(root,'main.ts'),'utf8');
const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const names=['initializeTablePresetRegistry','reloadCanonicalSettingsFromStorage','performCanonicalSettingsRefresh','refreshTablePresetRegistry','reportStartupPipelineTaxonomyDiagnostics','showOperonDocsSyncResult','syncOperonDocsNowUnlocked','recordInlineTaskCreationTarget','recordInlineTaskCreationFromEditor'];
const methods=[];
function visit(node){if(ts.isMethodDeclaration(node)&&names.includes(node.name.getText(ast)))methods.push(node.getText(ast));ts.forEachChild(node,visit);}
visit(ast);assert.equal(methods.length,names.length);
const compiled=ts.transpileModule('class Probe{'+methods.join('\n')+'}\nreturn Probe;',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
function fixture({blocked=false,refreshError,realRefresh=false,fileError,docsResult,docsError}={}){
 const warnings=[],errors=[],notices=[],calls=[],marks=[];
 const snapshot={entries:new Map(),fileDiagnostics:[]};
 const state={blocked,health:'ready'};
 class MigrationError extends Error{code='invalid-file';}
 class File{}
 const globals={SettingsWritesSuspendedError,console:{warn:(...args)=>warnings.push(args),error:(...args)=>errors.push(args)},Notice:class{constructor(message){notices.push(message);}},t:(_section,key)=>key,
  syncOperonDocs:async()=>{calls.push(['docs-sync']);if(docsError)throw docsError;return docsResult;},
  TablePresetRegistry:class{getSnapshot(){return snapshot;}async refresh(){calls.push(['registry-read']);}},TablePresetFileConflictResolver:class{},
  TFile:File,TFolder:class{},isOperonTableFilePath:()=>false,applyTablePresetPatch:()=>{},
  getOperonTableFilePathKey:value=>value.toLowerCase(),hasLocalePackIntentChanged:()=>false,
  migrateOperonTableFilesToV3:async()=>{calls.push(['migrate-v3']);if(fileError)throw fileError==='native'?new MigrationError('broken Table'):new Error('unrelated failure');return {status:'not-needed'};},
  migrateOperonTableFilesToV5:async()=>{calls.push(['migrate-v5']);return {status:'not-needed'};},
  TableFileV3MigrationError:MigrationError,TableFileV5MigrationError:MigrationError,
  inspectTableFileV3MigrationRecoveryEvidence:async()=>({affectedPaths:['Broken.table'],backupRootPath:null}),
  inspectTableFileV5MigrationRecoveryEvidence:async()=>({affectedPaths:['Broken.table'],backupRootPath:null})};
 const Probe=new Function(...Object.keys(globals),compiled)(...Object.values(globals));
 const probe=new Probe();probe.manifest={id:"operon"};
 probe.settings={language:'en',languagePackSubscriptions:[],tablePresetFileBindings:[],tablePresetFileInitialized:true,tablePresetOrderIds:[]};
 probe.storage={canPersistSettings:()=>!state.blocked,canRunTablePresetFileRecovery:()=>!state.blocked&&state.health!=='degraded',
  getTablePresetRecoveryDiagnostics:()=>({health:state.health}),markTablePresetDegraded:(...args)=>{marks.push(args);state.health='degraded';},recordTablePresetFileRepairs:()=>{},setTablePresetProtectedIds:()=>{},markTablePresetReadyAfterRescan:()=>{},
  reloadCanonicalSettingsPackage:async()=>{calls.push(['reload']);return {changed:false,diagnostics:{invalidDomains:[],pipelineTaxonomy:{backupFailed:false,issues:[]}}};}};
 probe.app={vault:{adapter:{},configDir:'.obsidian',getFiles:()=>[],getAbstractFileByPath:()=>null,read:async()=>'',on:()=>({}),offref:()=>{},process:()=>{}},fileManager:{}};
 probe.tablePresetRegistry=new globals.TablePresetRegistry();
 probe.tablePresetRegistrySubscriptions=new Map();probe.register=()=>{};probe.registerTablePresetFileWatchers=()=>calls.push(['watchers']);
 if(!realRefresh)probe.refreshTablePresetRegistry=async options=>{calls.push(['refresh',options]);if(refreshError&&options.persistBindings){state.blocked=refreshError==='paused';throw refreshError==='paused'?new SettingsWritesSuspendedError('test pause'):new Error('unrelated refresh failure');}};
 probe.reconcileCanonicalTablePresetFileAuthority=async()=>calls.push(['authority']);
 probe.ensureCanonicalTablePresetBootstrap=async()=>calls.push(['bootstrap']);
 probe.syncTablePresetProjectionFromRegistry=()=>false;probe.reconcileBoundTableFileNames=async()=>{calls.push(['rename']);return false;};
 probe.getTablePresetRegistryEntrySignature=entry=>JSON.stringify(entry);probe.syncTablePresetRegistrySubscriptions=()=>new Set();probe.handleSettingsChanged=()=>calls.push(['publish']);probe.synchronizeLanguagePacksAfterLayout=async()=>{};
 probe.refreshCanonicalSettingsSingleFlight=()=>probe.performCanonicalSettingsRefresh();
 return {probe,calls,marks,warnings,errors,notices,state,snapshot,File};
}

test('known settings pause reads Tables without migrations, saves, or false degradation',async()=>{
 const f=fixture({blocked:true});await f.probe.initializeTablePresetRegistry();
 assert.deepEqual(f.calls,[['refresh',{adoptUnbound:false,persistBindings:false,reconcileFileNames:false}],['watchers']]);
 assert.deepEqual(f.marks,[]);assert.deepEqual(f.warnings,[]);
});
test('writable startup retains migrations, normal authority and bootstrap',async()=>{
 const f=fixture();await f.probe.initializeTablePresetRegistry();
 assert.ok(f.calls.some(([name])=>name==='migrate-v3'));assert.ok(f.calls.some(([name])=>name==='migrate-v5'));
 assert.ok(f.calls.some(([name])=>name==='bootstrap'));assert.deepEqual(f.marks,[]);
});
test('pause beginning during startup refresh stays a settings issue with a read-only fallback',async()=>{
 const f=fixture({refreshError:'paused'});await f.probe.initializeTablePresetRegistry();
 assert.deepEqual(f.marks,[]);assert.deepEqual(f.warnings,[]);
 assert.ok(f.calls.some(([name,options])=>name==='refresh'&&options.persistBindings===false));
 assert.ok(!f.calls.some(([name])=>name==='authority'||name==='bootstrap'));
});
for(const fileError of ['native','unexpected'])test(`${fileError} Table failure is still reported once with evidence`,async()=>{
 const f=fixture({fileError});await f.probe.initializeTablePresetRegistry();
 assert.ok(f.marks.some(([code])=>code==='table-file-invalid'));
 assert.equal(f.warnings.length,1);assert.match(f.warnings[0][0],/Table recovery was isolated/);
 assert.deepEqual(f.marks[0][2].affectedPaths,['Broken.table']);
});
test('background refresh continues read recovery without Table writes while paused',async()=>{
 const f=fixture({blocked:true});for(let i=0;i<6;i++)await f.probe.reloadCanonicalSettingsFromStorage('background');
 assert.equal(f.calls.filter(([name])=>name==='reload').length,6);
 assert.ok(!f.calls.some(([name])=>name==='refresh'||name==='bootstrap'));assert.deepEqual(f.warnings,[]);assert.deepEqual(f.notices,[]);
 f.state.blocked=false;await f.probe.reloadCanonicalSettingsFromStorage('background');
 assert.ok(f.calls.some(([name,options])=>name==='refresh'&&options.persistBindings===true));
});
test('repeated typed pause errors do not become reload failures; explicit reload still gives feedback',async()=>{
 const f=fixture({blocked:true});f.probe.refreshCanonicalSettingsSingleFlight=async()=>{throw new SettingsWritesSuspendedError('pause');};
 for(let i=0;i<6;i++)await f.probe.reloadCanonicalSettingsFromStorage('background');
 assert.deepEqual(f.warnings,[]);assert.deepEqual(f.notices,[]);
 await f.probe.reloadCanonicalSettingsFromStorage('manual');assert.deepEqual(f.notices,['settingsWriteProtected']);
});
test('an unrelated reload failure remains visible even during a settings pause',async()=>{
 const f=fixture({blocked:true});f.probe.refreshCanonicalSettingsSingleFlight=async()=>{throw new Error('different failure');};
 await f.probe.reloadCanonicalSettingsFromStorage('background');assert.equal(f.warnings.length,1);assert.match(f.warnings[0][0],/reload failed/);
});
test('scheduled registry refresh uses read-only options during settings pause',async()=>{
 const f=fixture({blocked:true,realRefresh:true});await f.probe.refreshTablePresetRegistry({adoptUnbound:true,persistBindings:true});
 assert.deepEqual(f.calls,[['registry-read']]);assert.deepEqual(f.marks,[]);
});
for(const [kind,entry,diagnostic] of [
 ['invalid',null,{code:'invalid-json'}],['missing',{id:'missing',status:'missing'},null],['conflict',{id:'same',status:'conflict'},null]
])test(`real ${kind} file evidence remains visible in read-only registry`,async()=>{
 const f=fixture({blocked:true,realRefresh:true});if(entry)f.snapshot.entries.set(entry.id,entry);if(diagnostic)f.snapshot.fileDiagnostics.push(diagnostic);
 await f.probe.refreshTablePresetRegistry({adoptUnbound:true,persistBindings:true});
 assert.equal(f.marks.length,1);assert.match(f.marks[0][0],new RegExp(kind==='invalid'?'invalid':kind==='missing'?'missing':'duplicate'));
 assert.ok(!f.calls.some(([name])=>name==='authority'||name==='rename'));
});

// Exercise the actual startup reporting block without running migrations or opening Obsidian.
const reportingStart=source.indexOf('const finalTableRecovery = this.storage.getTablePresetRecoveryDiagnostics();');
const reportingEnd=source.indexOf('this.pinnedCache = this.storage.pinned;',reportingStart);
assert.ok(reportingStart>=0&&reportingEnd>reportingStart);
const reportTableStartup=new Function('console','Notice','t',source.slice(reportingStart,reportingEnd));
function reportFixture(diagnostics){
 const warnings=[],notices=[];
 reportTableStartup.call({storage:{getTablePresetRecoveryDiagnostics:()=>diagnostics}},
  {warn:(...args)=>warnings.push(args)},class{constructor(...args){notices.push(args);}},(_section,key)=>key);
 return {warnings,notices};
}
for(const code of ['table-file-invalid','table-file-missing','table-file-duplicate'])test(`startup Table notice policy retains ${code} diagnostics without generic popup or console noise`,()=>{
 const diagnostics=Object.freeze({health:'degraded',status:'degraded',code,detailCode:'test-evidence',affectedPaths:['Example.table']});
 for(let startup=0;startup<3;startup++){
  const f=reportFixture(diagnostics);
  assert.deepEqual(f.notices,[]);
  assert.deepEqual(f.warnings,[]);
 }
});
test('healthy Table startup is silent',()=>{
 assert.deepEqual(reportFixture({health:'ready',code:null}),{warnings:[],notices:[]});
});
test('ordinary automatic Table repair stays silent across startups',()=>{
 for(let i=0;i<3;i++)assert.deepEqual(reportFixture({health:'repaired',code:null}),{warnings:[],notices:[]});
});
test('completed duplicate Table identity repair retains its feedback',()=>{
 assert.deepEqual(reportFixture({health:'repaired',code:'table-file-duplicate'}),{warnings:[],notices:[['tableFileConflictRecoveryNotice',8000]]});
});

for(const backupFailed of [false,true])test(`startup taxonomy recovery ${backupFailed?'failure remains visible':'success is silent'}`,()=>{
 const f=fixture();const diagnostics=Object.freeze({backupFailed,backupPath:'backup.json',issues:['issue']});
 f.probe.storage.getStartupPipelineTaxonomyDiagnostics=()=>diagnostics;
 for(let i=0;i<3;i++)f.probe.reportStartupPipelineTaxonomyDiagnostics();
 assert.deepEqual(f.notices,backupFailed?Array(3).fill('pipelineTaxonomyRecoveryFailed'):[]);
 assert.deepEqual(f.warnings,[]);assert.deepEqual(f.errors,[]);
});
for(const mode of ['background','manual'])for(const changed of [false,true])test(`${mode} taxonomy repair with changed=${changed} preserves the reload result`,async()=>{
 const f=fixture();const result={changed,failed:false,diagnostics:{invalidDomains:[],pipelineTaxonomy:{backupFailed:false,backupPath:'backup.json',issues:['issue']}}};
 f.probe.refreshCanonicalSettingsSingleFlight=async()=>result;
 for(let i=0;i<3;i++)await f.probe.reloadCanonicalSettingsFromStorage(mode);
 assert.deepEqual(f.notices,mode==='manual'?Array(3).fill(['pipelineTaxonomyRecovered',changed?'settingsReloadedFromStorage':'settingsReloadUnchanged']).flat():[]);
 assert.deepEqual(f.warnings,[]);assert.deepEqual(f.errors,[]);
});
for(const mode of ['background','manual'])test(`${mode} taxonomy backup failure remains visible`,async()=>{
 const f=fixture();f.probe.refreshCanonicalSettingsSingleFlight=async()=>({changed:false,failed:true,diagnostics:{invalidDomains:[],pipelineTaxonomy:{backupFailed:true,issues:['issue']}}});
 await f.probe.reloadCanonicalSettingsFromStorage(mode);
 assert.deepEqual(f.notices,['pipelineTaxonomyRecoveryFailed']);assert.equal(f.warnings.length,1);
});
for(const mode of ['auto','manual'])for(const kind of ['unchanged','written','skipped','warning','stale'])test(`${mode} Docs ${kind} result preserves review feedback`,async()=>{
 const result={written:kind==='written'?['doc.md']:[],skipped:kind==='skipped'?['doc.md']:[],staleManagedFiles:kind==='stale'?['old.md']:[],warnings:kind==='warning'?['warning']:[]};
 const f=fixture({docsResult:result});
 for(let i=0;i<2;i++)assert.equal(await f.probe.syncOperonDocsNowUnlocked(mode),result);
 const needsReview=kind==='warning'||kind==='stale';
 const outcome=kind==='unchanged'||kind==='skipped'?'operonDocsSyncUpToDate':'operonDocsSyncComplete';
 assert.deepEqual(f.notices,mode==='manual'?['operonDocsSyncStarted',outcome,'operonDocsSyncStarted',outcome]:needsReview?['operonDocsSyncComplete','operonDocsSyncComplete']:[]);
 assert.deepEqual(f.calls,[['docs-sync'],['docs-sync']]);assert.deepEqual(f.warnings,[]);assert.deepEqual(f.errors,[]);assert.equal(f.probe.operonDocsSyncInFlight,null);
});
for(const mode of ['auto','manual'])test(`${mode} Docs write failure retains notice and original error`,async()=>{
 const error=new Error('Docs write failed');const f=fixture({docsError:error});
 assert.equal(await f.probe.syncOperonDocsNowUnlocked(mode),null);
 assert.deepEqual(f.notices,mode==='manual'?['operonDocsSyncStarted','operonDocsSyncFailed']:['operonDocsSyncFailed']);
 assert.equal(f.errors.length,1);assert.equal(f.errors[0][1],error);assert.equal(f.probe.operonDocsSyncInFlight,null);
});
function historyFixture({historyError,bufferError,missingTask=false}={}){
 const f=fixture();const file=new f.File();file.path='Task.md';
 f.probe.recordedInlineCreationIds=new Set();f.probe.app.vault.getMarkdownFiles=()=>[file];
 f.probe.app.vault.getAbstractFileByPath=()=>file;f.probe.app.vault.read=async()=>{f.calls.push(['read']);return 'saved task';};
 f.probe.persistMarkdownViewBuffer=async()=>{f.calls.push(['buffer-save']);if(bufferError)throw bufferError;};
 f.probe.findInlineTaskLineIndex=()=>missingTask?-1:0;
 f.probe.inlineTargetHistory={recordSuccess:async(...args)=>{f.calls.push(['history',...args]);if(historyError)throw historyError;}};
 return {...f,view:{file}};
}
for(const fail of [false,true])test(`destination history ${fail?'failure is console-only':'success stays silent'} after verified task save`,async()=>{
 const error=new Error('history write failed');const f=historyFixture({historyError:fail?error:undefined});
 for(let i=0;i<3;i++)await f.probe.recordInlineTaskCreationFromEditor(f.view,'task-id','Task.md');
 assert.deepEqual(f.calls,[['buffer-save'],['read'],['history','Task.md',['Task.md']]]);
 assert.deepEqual(f.notices,[]);assert.deepEqual(f.warnings,[]);assert.equal(f.errors.length,fail?1:0);
 if(fail)assert.equal(f.errors[0][1],error);
});
for(const kind of ['buffer','missing-task'])test(`unverified task creation ${kind} still reports failure before recording history`,async()=>{
 const f=historyFixture({bufferError:kind==='buffer'?new Error('buffer save failed'):undefined,missingTask:kind==='missing-task'});
 await f.probe.recordInlineTaskCreationFromEditor(f.view,'task-id','Task.md');
 assert.deepEqual(f.notices,['inlineTargetHistorySaveFailed']);assert.equal(f.errors.length,1);
 assert.ok(!f.calls.some(([name])=>name==='history'));assert.equal(f.probe.recordedInlineCreationIds.size,0);
});
