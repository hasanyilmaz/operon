import test from 'node:test';
import assert from 'node:assert/strict';
import { TFile, type App } from 'obsidian';
import { getNativePropertyIndex } from '../src/indexer/native-property-index';
import { OperonIndexer } from '../src/indexer/indexer';
import { scanFileWithMappings } from '../src/indexer/file-scanner';
import { DEFAULT_SETTINGS } from '../src/types/settings';
import type { IndexedTask } from '../src/types/fields';
import { cancelTableNativePropertyRequest, clearTableNativePropertySnapshot, getTableNativePropertySnapshot, getVerifiedTableRowKeys } from '../src/ui/table/table-native-property';
import { encodeTableFilePropertyColumnKey, type TableFilePropertySnapshot } from '../src/ui/table/table-file-property';

function fixture(count = 4) {
 const files = new Map<string, TFile>(), contents = new Map<string, string>(), reads: string[] = [];
 const tasks: IndexedTask[] = [];
 for (let i=0;i<count;i++) {
  const path=`N${i}.md`,id=`n${String(i).padStart(6,'0')}`;
  const file=new TFile(...([path] as unknown as []));Object.assign(file,{path,basename:`N${i}`,extension:'md',stat:{mtime:1,ctime:1,size:1}});files.set(path,file);
  contents.set(path,`- [ ] Task {{operonId:: ${id}}} {{Value:: ${i}}}\n`);
  tasks.push({operonId:id,primary:{filePath:path,format:'inline',lineNumber:0},description:'Task',fieldValues:{},tags:[],checkbox:'open',tier:'hot',datetimeModified:''});
 }
 let registryReads=0,active=0,max=0;
 const app={vault:{configDir:'.obsidian',getMarkdownFiles:()=>[...files.values()],getAbstractFileByPath:(path:string)=>files.get(path)??null,
  adapter:{read:async()=>{registryReads++;return '{"types":{"Value":"number"}}';}},
  read:async(file:TFile)=>{reads.push(file.path);active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,1));active--;return contents.get(file.path)!;}
 },metadataCache:{getFileCache:()=>({listItems:[{task:' '}]})}} as unknown as App;
 const settings=structuredClone(DEFAULT_SETTINGS);settings.keyMappings=[];
 const native=getNativePropertyIndex(app);native.configure(settings);native.setTypes({Value:'number'});
 const indexer=new OperonIndexer(app,{getSettings:()=>settings} as never);
 const edit=(path:string,value:string)=>{contents.set(path,contents.get(path)!.replace(/Value:: [^}]+/,`Value:: ${value}`));files.get(path)!.stat.mtime++;};
 return {app,files,contents,tasks,reads,settings,native,indexer,edit,registryReads:()=>registryReads,max:()=>max};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const base:TableFilePropertySnapshot={signature:'base',revision:1,fields:[],getCell:()=>({present:false,rawValue:undefined,normalizedValue:''}),getCandidates:()=>[]};

test('shared native full scan uses canonical reads once and only changed sources are decoded again',async()=>{
 const f=fixture();try {
  await f.indexer.fullReindex();await tick();assert.equal(f.reads.length,4);
  const tasks=f.indexer.getAllTasks();assert.equal(tasks.length,4);
  const rows=tasks.map(task=>f.native.getTask(task));assert.ok(rows.every(row=>row.available));
  const decoded=f.native.counters.projections;
  const key=encodeTableFilePropertyColumnKey('Value')!;
  for(let i=0;i<3;i++) {
   const snapshot=getTableNativePropertySnapshot({},f.app,base,tasks,1,f.settings,()=>assert.fail('warm surface callback'));
   assert.ok(!snapshot.loading);assert.equal(snapshot.getCell(tasks[0],key).rawValue,0);
  }
  await f.native.ensure(tasks);assert.equal(f.reads.length,4);assert.equal(f.registryReads(),0);
  f.edit('N0.md','20');await f.indexer.reindexFilePath('N0.md');await tick();
  assert.equal(f.reads.length,5);assert.equal(f.native.getTask(f.indexer.getTask('n000000')!).properties.get('value')!.value,20);
  assert.equal(f.native.getTask(f.indexer.getTask('n000001')!),rows[1]);
  assert.equal(f.native.counters.projections,decoded+1);
 } finally {f.indexer.destroy();}
});
test('cached-index hydration has at most two readers, coalesces demand and prioritizes visible sources',async()=>{
 const f=fixture(12);try {
  // Equivalent to V8 membership publication; the cache contains no native fragments.
  f.native.reconcile(f.tasks,new Set());
  const background=f.native.ensure(f.tasks,false);
  const visible=f.native.ensure([f.tasks[11],f.tasks[11]],true);
  await Promise.all([background,visible]);assert.equal(f.reads.length,12);assert.equal(new Set(f.reads).size,12);
  assert.equal(f.max(),2);assert.equal(f.reads[2],'N11.md');
  assert.equal(f.native.counters.scans,12);assert.ok(f.native.isReady(f.tasks));
  await f.native.ensure(f.tasks);assert.equal(f.reads.length,12);
 } finally {f.indexer.destroy();}
});
test('normal pending reindex joins editor and table demand without a separate read',async()=>{
 const f=fixture(2);try {
  await f.indexer.fullReindex();f.edit('N0.md','55');f.indexer.scheduleReindex('N0.md');
  const pending=f.native.ensure([f.indexer.getTask('n000000')!]);
  await f.indexer.flushPendingRamReindexNow();await pending;
  assert.equal(f.reads.filter(path=>path==='N0.md').length,2);assert.equal(f.native.getTask(f.indexer.getTask('n000000')!).properties.get('value')!.value,55);
 } finally {f.indexer.destroy();}
});
test('batch source publication waits for all canonical scans and releases only its own pending paths',async()=>{
 const f=fixture(3);try {
  await f.indexer.fullReindex();await tick();f.edit('N0.md','40');f.edit('N1.md','41');
  const observed:unknown[][]=[];
  const off=f.native.subscribe(()=>{observed.push(['n000000','n000001'].map(id=>f.native.getTask(f.indexer.getTask(id)!).properties.get('value')?.value));});
  await f.indexer.reindexFilesBatch(['N0.md','N1.md']);await tick();
  assert.deepEqual(observed,[[40,41]]);off();
  f.edit('N0.md','50');f.edit('N2.md','52');
  const first=f.indexer.reindexFilePath('N0.md'),second=f.indexer.reindexFilePath('N2.md');
  await first;
  assert.equal(f.native.isReady([f.indexer.getTask('n000002')!]),false,'queued unrelated reindex remains pending');
  await second;assert.equal(f.native.getTask(f.indexer.getTask('n000002')!).properties.get('value')?.value,52);
  assert.equal(f.reads.filter(path=>path==='N2.md').length,2);
 } finally {f.indexer.destroy();}
});
test('source delete, exclusion and rename retire native records and pending identities',async()=>{
 const f=fixture(3);try {
  await f.indexer.fullReindex();const old=f.indexer.getTask('n000000')!;
  f.indexer.scheduleReindex('N0.md');const waiting=f.native.ensure([old]);
  const file=f.files.get('N0.md')!;f.files.delete('N0.md');file.path='Moved.md';f.files.set('Moved.md',file);f.contents.set('Moved.md',f.contents.get('N0.md')!);f.contents.delete('N0.md');
  f.indexer.handleFileRename('N0.md','Moved.md');await tick();await waiting;
  await f.indexer.flushPendingRamReindexNow();const moved=f.indexer.getTask('n000000')!;
  assert.equal(moved.primary.filePath,'Moved.md');assert.equal(f.native.getTask(moved).available,true);assert.equal(f.native.getTask(old).available,false);
  f.files.delete('N1.md');f.indexer.handleFileDelete('N1.md');await tick();
  assert.equal(f.native.getTask(f.tasks[1]).available,false);
  // Removing membership also retires a queued pending source safely.
  f.native.markPending('N2.md');const pending=f.native.ensure([f.tasks[2]]);f.native.reconcile([moved],new Set());await pending;
  assert.equal(f.native.getTask(f.tasks[2]).available,false);
 } finally {f.indexer.destroy();}
});
test('sparse records do not allocate missing properties; type changes reuse raw values and preserve negative zero',async()=>{
 const f=fixture(1);try {
  f.contents.set('N0.md','---\noperonId: n000000\nValue: -0\n---\nLarge body that must not be retained\n');f.tasks[0].primary.format='yaml';
  await f.native.ensure(f.tasks);const first=f.native.getTask(f.tasks[0]);assert.equal(first.properties.size,1);assert.ok(Object.is(first.properties.get('value')!.value,-0));
  f.native.setTypes(Object.fromEntries(Array.from({length:500},(_,i)=>[`Missing${i}`,'text' as const]).concat([['Value','number' as never]])));
  assert.equal(f.native.getTask(f.tasks[0]).properties.size,1);assert.equal(f.reads.length,1);
  f.contents.set('N0.md',f.contents.get('N0.md')!.replace('Value: -0','Value: 0'));f.files.get('N0.md')!.stat.mtime++;
  f.native.accept('N0.md',(await scanFileWithMappings(f.app,f.files.get('N0.md')!,[])).nativeProperties);
  assert.ok(Object.is(f.native.getTask(f.tasks[0]).properties.get('value')!.value,0));
 } finally {f.indexer.destroy();}
});
test('unload releases pending consumers and ignores late source or registry completion',async()=>{
 const f=fixture(1);let release=()=>{};
 f.app.vault.read=async()=>new Promise<string>(resolve=>{release=()=>resolve(f.contents.get('N0.md')!);});
 let notifications=0;f.native.subscribe(()=>{notifications++;});await tick();notifications=0;
 const wait=f.native.ensure(f.tasks);f.indexer.destroy();await wait;release();await tick();
 assert.equal(notifications,0);assert.equal(f.native.getTask(f.tasks[0]).available,false);
});

test('Automatic catalog types and numeric ordering survive shared snapshot adaptation',async()=>{
 const f=fixture(2);try {
  f.native.setTypes({});await f.indexer.fullReindex();
  const key=encodeTableFilePropertyColumnKey('Value')!;
  const catalog:TableFilePropertySnapshot={...base,fields:[{key,label:'Value',propertyName:'Value',type:'number',sourceType:'number',group:'fileProperty',icon:'hash',readonly:true,aliases:[],sourceFileCount:2}]};
  const snapshot=getTableNativePropertySnapshot({},f.app,catalog,f.indexer.getAllTasks(),1,f.settings,()=>{});
  assert.equal(snapshot.fields[0].type,'number');assert.equal(snapshot.fields[0].sourceType,'number');
  assert.equal(snapshot.fields[0].icon,'shield-alert');assert.equal(snapshot.getCell(f.indexer.getTask('n000000')!,key).readOnlyReason,'automatic');
  const reads=f.reads.length;
  f.native.setTypes({Value:'number'});
  const explicit=getTableNativePropertySnapshot({},f.app,catalog,f.indexer.getAllTasks(),1,f.settings,()=>{});
  assert.equal(explicit.fields[0].icon,'hash');assert.equal(explicit.getCell(f.indexer.getTask('n000000')!,key).readOnlyReason,undefined);
  assert.equal(f.reads.length,reads);
 } finally {f.indexer.destroy();}
});
test('failed changed source settles as unavailable with the last value, without an automatic read loop',async()=>{
 const f=fixture(1);try {
  await f.indexer.fullReindex();const task=f.indexer.getTask('n000000')!;
  f.edit('N0.md','99');f.app.vault.read=async()=>{throw Error('source-unavailable');};
  await f.indexer.reindexFilePath('N0.md');
  assert.equal(f.native.isReady([task]),true);
  const snapshot=getTableNativePropertySnapshot({},f.app,base,[task],1,f.settings,()=>assert.fail('error must not trigger reload loop'));
  assert.ok(!snapshot.loading);const cell=snapshot.getCell(task,encodeTableFilePropertyColumnKey('Value')!);
  assert.equal(cell.rawValue,0);assert.equal(cell.readOnlyReason,'unavailable');
 } finally {f.indexer.destroy();}
});
test('unload never rerenders a waiting table or replaces a disposed shared service',async()=>{
 const f=fixture(1);let release=()=>{};let ready=0;
 f.app.vault.read=async()=>new Promise<string>(resolve=>{release=()=>resolve(f.contents.get('N0.md')!);});
 const snapshot=getTableNativePropertySnapshot({},f.app,base,f.tasks,1,f.settings,()=>{ready++;});
 assert.equal(snapshot.loading,true);f.indexer.destroy();await tick();release();await tick();
 assert.equal(ready,0);assert.equal(f.native.isActive(),false);
});
test('late hydration cannot overwrite a newer canonical source or revive duplicate identity edits',async()=>{
 const f=fixture(2);try {
  let release=()=>{};const read=f.app.vault.read.bind(f.app.vault),old=f.contents.get('N0.md')!;
  f.app.vault.read=async file=>file.path==='N0.md'?new Promise<string>(resolve=>{release=()=>resolve(old);}):read(file);
  const hydrate=f.native.ensure([f.tasks[0]]);await tick();
  f.app.vault.read=read;f.edit('N0.md','88');await f.indexer.fullReindex();release();await hydrate;
  assert.equal(f.native.getTask(f.indexer.getTask('n000000')!).properties.get('value')?.value,88);
  f.contents.set('N1.md',f.contents.get('N1.md')!.replace('n000001','n000000'));f.files.get('N1.md')!.stat.mtime++;
  await f.indexer.reindexFilePath('N1.md');
  assert.equal(f.native.getTask(f.indexer.getTask('n000000')!).available,false);
 } finally {f.indexer.destroy();}
});

test('real V8 hydration prepares only known task sources once and keeps its persistent payload unchanged',async()=>{
 const f=fixture(6);f.indexer.destroy();
 const {buildIndexV8Snapshot,validateIndexV8Snapshot,deriveIndexV8InstanceKey}=await import('../src/indexer/persistence/index-v8-codec');
 const {buildIndexV8SemanticsSignature}=await import('../src/indexer/persistence/index-v8-semantics');
 const instances=f.tasks.map(task=>({...task,instanceKey:deriveIndexV8InstanceKey(task.primary.filePath,task.primary.lineNumber,task.primary.format)}));
 const now='2026-10-09T12:00:00.000Z';
 const persisted=await buildIndexV8Snapshot({committedAt:now,lastFullScanAt:now,coherenceBasis:'verified-full-scan',indexSemanticsSignature:buildIndexV8SemanticsSignature(f.settings),
  sources:instances.map(instance=>({path:instance.primary.filePath,mtimeMs:1,sizeBytes:1,instances:[instance]}))});
 const validatedSnapshot=await validateIndexV8Snapshot(persisted.manifestPayload,persisted.shardPayloads);
 const store={load:async()=>({status:'loaded' as const,manifest:persisted.manifest,manifestPayload:persisted.manifestPayload,shards:persisted.shards,validatedSnapshot,
  metrics:{manifestBytes:0,shardBytes:0,shardsRead:32,totalMs:0}})};
 const native=getNativePropertyIndex(f.app);native.configure(f.settings);native.setTypes({Value:'number'});
 const indexer=new OperonIndexer(f.app,{getSettings:()=>f.settings} as never,null,store);
 try {
  f.app.vault.getMarkdownFiles=()=>assert.fail('warm hydration must not enumerate the vault');
  assert.equal((await indexer.loadCachedIndex()).status,'loaded');
  await native.ensure(indexer.getAllTasks());assert.equal(f.reads.length,6);assert.equal(f.max(),2);
  assert.equal(native.getTask(indexer.getTask('n000005')!).properties.get('value')?.value,5);
  const readCount=f.reads.length;await native.ensure(indexer.getAllTasks());assert.equal(f.reads.length,readCount);
  assert.ok(!persisted.manifestPayload.includes('nativeProperties'));
  assert.deepEqual(JSON.parse(persisted.manifest.indexSemanticsSignature).inlinePropertyDefinitions, f.settings.inlinePropertyDefinitions ?? null);
 } finally {indexer.destroy();}
});

test('table native return reuses one successful snapshot without source reads or row projections',async()=>{
 const f=fixture();try {
  await f.indexer.fullReindex();const owner={},other={},tasks=f.indexer.getAllTasks();
  const get=(target:object,needed=true)=>getTableNativePropertySnapshot(target,f.app,base,tasks,1,f.settings,()=>assert.fail('ready data must be synchronous'),needed);
  const first=get(owner),independent=get(other),reads=f.reads.length;
  const original=f.native.getTask.bind(f.native);let projections=0;
  f.native.getTask=task=>{projections++;return original(task);};
  assert.equal(get(owner,false),base);
  assert.equal(get(owner),first);assert.equal(get(other),independent);assert.equal(projections,0);assert.equal(f.reads.length,reads);
  const value = first.fields.find(field => field.propertyName === 'Value');
  assert.equal(value?.icon, 'hash');
  f.settings.vaultPropertyIcons = { value: 'book-open' };
  assert.equal(get(owner), first, 'an icon edit reuses the open table projection');
  assert.equal(value?.icon, 'book-open');
  assert.equal(projections, 0);
  assert.equal(f.reads.length, reads);
  assert.equal(getTableNativePropertySnapshot(owner,f.app,{...base},tasks.map(task=>({...task,primary:{...task.primary}})),1,f.settings,()=>{}),first);
  clearTableNativePropertySnapshot(owner);assert.notEqual(get(owner),first);assert.equal(get(other),independent);
 } finally {f.indexer.destroy();}
});

for (const change of ['membership','order','line','format','path','id','generation','base-signature','base-revision'] as const) test(`table snapshot detects ${change} changes with unchanged task count`,async()=>{
 const f=fixture(3);try {
  await f.indexer.fullReindex();const owner={};let tasks=f.indexer.getAllTasks().slice(0,2).map(task=>({...task,primary:{...task.primary}})),generation=1,catalog=base;
  const get=()=>getTableNativePropertySnapshot(owner,f.app,catalog,tasks,generation,f.settings,()=>{});
  const first=get();
  switch(change){
   case 'membership':tasks=[tasks[0],f.indexer.getTask('n000002')!];break;
   case 'order':tasks.reverse();break;
   case 'line':tasks[0].primary.lineNumber++;break;
   case 'format':tasks[0].primary.format='yaml';break;
   case 'path':tasks[0].primary.filePath='N2.md';break;
   case 'id':tasks[0].operonId='n000002';break;
   case 'generation':generation++;break;
   case 'base-signature':catalog={...base,signature:'changed'};break;
   case 'base-revision':catalog={...base,revision:2};break;
  }
  assert.notEqual(get(),first);assert.ok(!get().loading);
 } finally {f.indexer.destroy();}
});

test('hidden table snapshots invalidate on value, property removal, types and mappings',async()=>{
 const f=fixture(1);try {
  await f.indexer.fullReindex();const owner={},key=encodeTableFilePropertyColumnKey('Value')!;
  const get=(needed=true)=>getTableNativePropertySnapshot(owner,f.app,base,f.indexer.getAllTasks(),f.indexer.getGeneration(),f.settings,()=>{},needed);
  let previous=get();get(false);f.edit('N0.md','55');await f.indexer.reindexFilePath('N0.md');
  let next=get();assert.notEqual(next,previous);assert.equal(next.getCell(f.indexer.getTask('n000000')!,key).rawValue,55);
  previous=next;get(false);f.contents.set('N0.md',f.contents.get('N0.md')!.replace(' {{Value:: 55}}',''));f.files.get('N0.md')!.stat.mtime++;
  await f.indexer.reindexFilePath('N0.md');next=get();assert.notEqual(next,previous);assert.equal(next.getCell(f.indexer.getTask('n000000')!,key).present,false);
  previous=next;get(false);f.native.setTypes({Value:'checkbox'});next=get();assert.notEqual(next,previous);assert.equal(next.fields.find(field=>field.propertyName==='Value')?.type,'checkbox');
  previous=next;get(false);f.settings.keyMappings.push({canonicalKey:'customValue',visiblePropertyName:'Value',type:'text',enabled:true,isSystem:false,sync:'no'});
  next=get();assert.notEqual(next,previous);assert.equal(next.fields.some(field=>field.propertyName==='Value'),false);
 } finally {f.indexer.destroy();}
});

test('warm cache still checks pending work and source stamps before serving values',async()=>{
 const f=fixture(1);try {
  await f.indexer.fullReindex();const owner={},tasks=f.indexer.getAllTasks();let ready=0;
  const get=(needed=true)=>getTableNativePropertySnapshot(owner,f.app,base,tasks,1,f.settings,()=>{ready++;},needed);
  const first=get(),revision=f.native.getRevision();f.native.markPending('N0.md');
  assert.equal(f.native.getRevision(),revision);assert.equal(get().loading,true);
  assert.equal(get().getCell(tasks[0],encodeTableFilePropertyColumnKey('Value')!).readOnlyReason,'unavailable');
  get(false);f.native.finishPending('N0.md');await tick();assert.equal(ready,0);assert.equal(get(),first);
  f.edit('N0.md','88');assert.equal(get().loading,true);await f.native.ensure(tasks);await tick();
  assert.equal(ready,1);assert.equal(get().getCell(tasks[0],encodeTableFilePropertyColumnKey('Value')!).rawValue,88);
 } finally {f.indexer.destroy();}
});

test('pending table requests follow latest scope, cancellation and independent surface lifetimes',async()=>{
 const f=fixture(2);try {
  await f.indexer.fullReindex();const owner={},other={},tasks=f.indexer.getAllTasks();let old=0,current=0,second=0;
  f.native.markPending('N0.md');f.native.markPending('N1.md');
  const get=(target:object,scope:IndexedTask[],callback:()=>void)=>getTableNativePropertySnapshot(target,f.app,base,scope,1,f.settings,callback);
  get(owner,[tasks[0]],()=>{old++;});get(owner,[tasks[1]],()=>{old++;});get(owner,[tasks[0]],()=>{current++;});
  get(other,[tasks[1]],()=>{second++;});f.native.finishPending('N1.md');await tick();assert.equal(old,0);assert.equal(current,0);assert.equal(second,1);
  // Same pending scope refreshes its callback without registering another completion.
  get(owner,[tasks[0]],()=>{current+=10;});f.native.finishPending('N0.md');await tick();assert.equal(current,10);assert.equal(old,0);
  for(const cancel of [cancelTableNativePropertyRequest,clearTableNativePropertySnapshot]){
   f.native.markPending('N0.md');get(owner,[tasks[0]],()=>{old++;});cancel(owner);
   get(other,[tasks[0]],()=>{second++;});f.native.finishPending('N0.md');await tick();assert.equal(old,0);
  }
  assert.equal(second,3);
 } finally {f.indexer.destroy();}
});

test('retained table snapshot does not revive deleted, moved, duplicate or empty identities',async()=>{
 const f=fixture(2);try {
  await f.indexer.fullReindex();const owner={};let tasks=f.indexer.getAllTasks();
  const get=(needed=true)=>getTableNativePropertySnapshot(owner,f.app,base,tasks,1,f.settings,()=>{},needed),key=encodeTableFilePropertyColumnKey('Value')!;
  const first=get();get(false);const file=f.files.get('N0.md')!;f.files.delete('N0.md');file.path='Moved.md';f.files.set(file.path,file);f.contents.set(file.path,f.contents.get('N0.md')!);
  f.indexer.handleFileRename('N0.md',file.path);await tick();await f.indexer.flushPendingRamReindexNow();tasks=f.indexer.getAllTasks();
  assert.notEqual(get(),first);assert.equal(get().getCell(f.indexer.getTask('n000000')!,key).rawValue,0);
  get(false);f.files.delete('N1.md');await f.indexer.handleFileDelete('N1.md');assert.equal(get().getCell(tasks.find(task=>task.operonId==='n000001')!,key).readOnlyReason,'unavailable');
  tasks=[tasks[0],tasks[0]];assert.equal(get().getCell(tasks[0],key).readOnlyReason,'unavailable');
  tasks=[{...tasks[0],operonId:''}];assert.equal(get().getCell(tasks[0],key).readOnlyReason,'unavailable');
 } finally {f.indexer.destroy();}
});


test('table committed source settlement consumes the queued scan without trusting a pre-write flight', async () => {
 const f=fixture(2);try {
  await f.indexer.fullReindex();f.edit('N0.md','77');f.indexer.scheduleReindex('N0.md');
  const before=f.reads.length;await f.indexer.reindexCommittedMutationSources(['N0.md'],{notify:false});
  assert.equal(f.native.getTask(f.indexer.getTask('n000000')!).properties.get('value')!.value,77);
  await new Promise(resolve=>setTimeout(resolve,280));assert.equal(f.reads.length-before,1);
  const original=f.app.vault.read.bind(f.app.vault);let release!:()=>void;let entered!:()=>void;
  const started=new Promise<void>(resolve=>entered=resolve), gate=new Promise<void>(resolve=>release=resolve);let first=true;
  f.app.vault.read=async file=>{const captured=await original(file);if(first){first=false;entered();await gate;}return captured;};
  const stale=f.indexer.reindexFilePath('N0.md',{notify:false});await started;f.edit('N0.md','88');
  const committed=f.indexer.reindexCommittedMutationSources(['N0.md'],{notify:false});release();await Promise.all([stale,committed]);
  assert.equal(f.native.getTask(f.indexer.getTask('n000000')!).properties.get('value')!.value,88);
 } finally {f.indexer.destroy();}
});

test('pending tables require positive row validity, including context rows and native-only changes', async () => {
 const f=fixture(3);try {
  await f.indexer.fullReindex();const tasks=f.indexer.getAllTasks(), old=new Map(tasks.map(task=>[task.operonId,task]));
  const key=encodeTableFilePropertyColumnKey('Value')!;
  const snapshot=getTableNativePropertySnapshot({},f.app,base,tasks,1,f.settings,()=>{});
  const state={columns:[{key}],valueResolver:{taskLookup:{getTask:(id:string)=>old.get(id)}},getFilePropertyCell:snapshot.getCell,getContextFilePropertyCell:snapshot.getCell};
  const rows=tasks.map(task=>({dataset:{operonId:task.operonId},classList:{contains:()=>false}} as unknown as HTMLElement));
  const verified=()=>getVerifiedTableRowKeys(f.app,rows,state as never,id=>f.indexer.getTask(id));
  const context={dataset:{operonId:tasks[0].operonId,operonVirtualRowKey:'context'},classList:{contains:()=>true}} as unknown as HTMLElement;
  const normal={dataset:{operonId:tasks[0].operonId,operonVirtualRowKey:'normal'},classList:{contains:()=>false}} as unknown as HTMLElement;
  const separate=getVerifiedTableRowKeys(f.app,[normal,context],{...state,getContextFilePropertyCell:()=>({nativeState:'unsupported'})} as never,id=>f.indexer.getTask(id));
  assert.ok(separate.has('normal'));assert.ok(!separate.has('context'),'each occurrence requires its own validity proof');
  f.native.markPending('N0.md');assert.deepEqual([...verified()].sort(),['n000001','n000002']);
  f.native.finishPending('N0.md');f.edit('N1.md','99');await f.indexer.reindexFilePath('N1.md');
  assert.ok(!verified().has('n000001'),'ready but changed native data does not validate old DOM');
  assert.ok(verified().has('n000002'),'an unrelated source remains usable');
  old.set('n000002',{...old.get('n000002')!,description:'obsolete'});assert.ok(!verified().has('n000002'));
  const missing=getVerifiedTableRowKeys(f.app,rows,state as never,()=>null);assert.equal(missing.size,0);
 } finally {f.indexer.destroy();}
});
