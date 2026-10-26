import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type * as Typescript from 'typescript';
import { TFile } from 'obsidian';
import { customKeySourceUses, prepareCustomKeyTypeReuse } from '../src/ui/custom-key-type-reuse';
import { NativeLightboxLifecycle } from '../src/ui/native-lightbox-lifecycle';
import { TablePresetRegistry } from '../src/storage/table-preset-registry';
import { parseOperonTableFile, serializeOperonTableFile } from '../src/storage/table-file';
import { applyTablePresetPatch } from '../src/ui/table/table-preset-model';
import { createDefaultTablePreset, cloneTablePreset, OPERON_TABLE_VIEW_TYPE, OPERON_TABLE_FILE_VIEW_TYPE, type TablePreset } from '../src/types/table';
import type { KeyMapping } from '../src/types/settings';
import { SettingsPreservationHarness } from './test-support/settings-preservation-harness';

// Execute the actual Table reader and its preset selection methods. FileView's
// public contract deliberately provides neither editor nor getViewData.
const ts: typeof Typescript = createRequire(`${process.cwd()}/package.json`)('typescript');
const source = ts.createSourceFile('table.ts', readFileSync('src/ui/table/operon-table-view.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const tableClass = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'OperonTableView') as Typescript.ClassDeclaration;
assert.equal(tableClass.heritageClauses?.[0].types[0].expression.getText(source), 'FileView');
const names = ['getViewType', 'getPropertySourceSnapshot', 'getCurrentPreset', 'resolveAvailableTablePreset', 'getAvailableTablePresets'];
const members = tableClass.members.filter(member => member.name && names.includes(member.name.getText(source)));
assert.equal(members.length, names.length);
const compiled = ts.transpileModule(`class TableReader extends FileView { ${members.map(member => member.getText(source)).join('\n')} }; return TableReader;`, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const TableReader = new Function('FileView', 'serializeOperonTableFile', 'createDefaultTablePreset', 'OPERON_TABLE_VIEW_TYPE', 'OPERON_TABLE_FILE_VIEW_TYPE', compiled)(class {}, serializeOperonTableFile, createDefaultTablePreset, OPERON_TABLE_VIEW_TYPE, OPERON_TABLE_FILE_VIEW_TYPE);

async function fixture() {
 const disk = new SettingsPreservationHarness({table:false,inlinePropertyBackups:true});
 const storage = disk.createStorage();
 const app: any = (storage as any).app;
 const adapter = app.vault.adapter;
 const types: Record<string,string> = {};
 let nativeWrites = 0, tableWrites = 0, afterRead = () => {}, afterTypeWrite = () => {};
 const files = new Map<string,any>(), views: any[] = [], events = new Set<unknown>();
 app.vault.adapter = {...adapter,
  exists: async(path:string) => path === '.obsidian/types.json' || adapter.exists(path),
  read: async(path:string) => path === '.obsidian/types.json' ? JSON.stringify({types}) : adapter.read(path),
 };
 Object.assign(app.vault, {
  getFiles:()=>[...files.values()], getMarkdownFiles:()=>[...files.values()].filter(f=>f.extension==='md'),
  getAbstractFileByPath:(path:string)=>files.get(path)??null,
  read:async(file:any)=>{const content=file.content;afterRead();return content;},
  on:(_event:string,callback:unknown)=>{events.add(callback);return callback;},offref:(callback:unknown)=>events.delete(callback),
 });
 app.workspace={iterateAllLeaves:(callback:any)=>views.forEach(view=>callback(view.leaf??{view})),getLeavesOfType:()=>[]};
 app.metadataTypeManager={getAssignedWidget:(name:string)=>types[name]??null,setType:async(name:string,type:string)=>{nativeWrites++;types[name]=type;afterTypeWrite();}};
 await storage.initialize();
 const key=(type:KeyMapping['type']='text'):KeyMapping=>({canonicalKey:'test123',visiblePropertyName:'test123',type,enabled:true,sync:'yes',isSystem:false,icon:'star'});
 await storage.saveCustomKeyMapping(key());types.test123='text';
 await storage.saveCustomKeyMapping(storage.getSettings().keyMappings.find(m=>m.canonicalKey==='test123')!,{remove:true});
 const registry = new TablePresetRegistry<any>({
  loadFileBindings:()=>[], listTableFiles:()=>[...files.values()].filter(f=>f.extension==='table'),
  readTableFile:file=>file.content, applyPatch:applyTablePresetPatch,
  writeTableFile:async()=>{tableWrites++;throw Error('verification must not flush Table writes');},
  schedulePatch:()=>1,cancelScheduledPatch:()=>{},
 });
 async function table(preset=createDefaultTablePreset(), fileMode=true) {
  const content=serializeOperonTableFile(preset);
  const file=Object.assign(Object.create(TFile.prototype),{path:'Boards/Open.table',extension:'table',content,stat:{mtime:1,size:content.length}});
  files.set(file.path,file);await registry.refresh();
  const view:any=new TableReader();
  Object.assign(view,{fileMode,file:fileMode?file:null,fileLoadState:'loaded',filePreset:cloneTablePreset(preset),state:{presetId:preset.id},
   getSettings:()=>storage.getSettings(),ensureState:()=>view.state,
   callbacks:{
    resolveTablePreset:(id:string)=>registry.getPreset(id),getTablePresets:()=>[...registry.getSnapshot().entries.values()].flatMap(e=>e.preset?[e.preset]:[]),
    resolveTableFile:(path:string,source:string)=>{const parsed=parseOperonTableFile(source,path);return {preset:parsed.status==='valid'?registry.projectFilePreset(path,parsed.preset):null,diagnostics:[]};},
   },
  });
  assert.equal(view.getViewData,undefined);assert.equal(view.editor,undefined);
  views.push(view);return {view,file,preset};
 }
 function deferred(viewType='markdown',content='# Unused source') {
  const file=Object.assign(Object.create(TFile.prototype),{path:viewType==='markdown'?'Deferred.md':'Deferred.table',extension:viewType==='markdown'?'md':'table',content,stat:{mtime:1,size:content.length}});
  files.set(file.path,file);
  // Native deferred views report the future type/state, with no FileView or editor yet.
  const view:any={getViewType:()=>viewType,getState:()=>({file:file.path})};
  const leaf={view,isDeferred:true,loadIfDeferred:async()=>{throw Error('verification must not load background tabs');}};
  view.leaf=leaf;views.push(view);return {leaf,view,file};
 }
 const add=(type:KeyMapping['type']='number')=>storage.saveCustomKeyMapping(key(type),{prepare:settings=>prepareCustomKeyTypeReuse(app,settings,key(type),()=>storage.getSettings())});
 const queue=(preset:TablePreset,patch:any)=>{const ticket=registry.queuePatch(preset.id,'test',{id:preset.id,...patch});void ticket.settled.catch(()=>{});return ticket;};
 return {disk,storage,app,types,files,views,events,table,deferred,add,queue,registry,
  writes:()=>nativeWrites,tableWrites:()=>tableWrites,
  afterRead:(callback:()=>void)=>{afterRead=callback;},afterTypeWrite:(callback:()=>void)=>{afterTypeWrite=callback;},
  close:async()=>{registry.cancelPatches();await disk.dispose();},
 };
}
const displayPreset=()=>{const preset=createDefaultTablePreset();preset.columns.push({key:'test123',kind:'task'});return preset;};

for(const mode of ['tab','other-window','lightbox','preset'] as const) test(`real FileView Table reader allows unused display column: ${mode}`,async()=>{
 const f=await fixture();let owner:NativeLightboxLifecycle|undefined;
 try{
  const {view,file}=await f.table(displayPreset(),mode!=='preset');
  if(mode==='other-window') f.app.workspace.getLeavesOfType=()=>[]; // iterateAllLeaves owns all windows.
  if(mode==='lightbox'){f.views.length=0;owner=new NativeLightboxLifecycle(f.app,{view} as any);}
  const before=file.content;await f.add();
  assert.equal(f.types.test123,'number');assert.equal(f.storage.getSettings().keyMappings.find(m=>m.canonicalKey==='test123')!.type,'number');
  assert.equal(file.content,before);assert.equal(f.tableWrites(),0);assert.equal(f.events.size,0);
 }finally{owner?.dispose();await f.close();}
});
test('an unrelated open Table also permits a type change',async()=>{
 const f=await fixture();try{await f.table();await f.add();assert.equal(f.types.test123,'number');}finally{await f.close();}
});
for(const dependency of ['sortRules','groupBy','subgroupBy','summaries'] as const) for(const fileMode of [false,true]) test(`real Table pending ${dependency} protects the type, file=${fileMode}`,async()=>{
 const f=await fixture();try{
  const base=displayPreset();if(dependency==='subgroupBy')base.groupBy='status';
  const {view,preset,file}=await f.table(base,fileMode);
  const value=dependency==='sortRules'?[{key:'test123',direction:'asc',empty:'last'}]:dependency==='summaries'?[{key:'test123',function:'Count'}]:'test123';
  f.queue(preset,{[dependency]:value});
  const parsed=parseOperonTableFile(view.getPropertySourceSnapshot());assert.equal(parsed.status,'valid');
  if(parsed.status==='valid')assert.deepEqual(parsed.preset[dependency],value);
  assert.equal(parseOperonTableFile(file.content).status,'valid');
  await assert.rejects(f.add(),/still used|referenced/);assert.equal(f.types.test123,'text');assert.equal(f.writes(),0);assert.equal(f.tableWrites(),0);
 }finally{await f.close();}
});
test('a pending filter reference is preserved without flushing the Table',async()=>{
 const f=await fixture();try{
  const {preset}=await f.table(displayPreset());
  f.storage.getSettings().filterSets.push({id:'using-key',name:'Filter',filterGroup:{conditions:[{field:'test123',operator:'exists'}]}} as any);
  f.queue(preset,{filterSetId:'using-key'});
  await assert.rejects(f.add(),/referenced/);assert.equal(f.types.test123,'text');assert.equal(f.writes(),0);assert.equal(f.tableWrites(),0);
 }finally{await f.close();}
});
for(const state of ['loading','invalid','unloaded','missing-preset'] as const) test(`unready Table stays blocked with path and type: ${state}`,async()=>{
 const f=await fixture();try{
  const {view}=await f.table();
  if(state==='unloaded'){view.file=null;view.fileLoadState='loading';}
  else if(state==='missing-preset')view.filePreset=null;
  else view.fileLoadState=state;
  const before=f.disk.raw();await assert.rejects(f.add(),error=>error instanceof Error && error.message.includes('Cannot verify an open property source:') && error.message.includes(state==='unloaded'?'(unsaved)':'Boards/Open.table') && error.message.includes(OPERON_TABLE_FILE_VIEW_TYPE));
  assert.equal(f.types.test123,'text');assert.equal(f.writes(),0);assert.equal(f.disk.raw(),before);
 }finally{await f.close();}
});
for(const change of ['draft','rename','unload','close'] as const) test(`Table ${change} during verification cancels before type writes`,async()=>{
 const f=await fixture();try{
  const {view,file,preset}=await f.table();let once=false;
  f.afterRead(()=>{if(once)return;once=true;
   if(change==='draft')f.queue(preset,{groupBy:'test123'});
   if(change==='rename')file.path='Boards/Renamed.table';
   if(change==='unload')view.fileLoadState='loading';
   if(change==='close')f.views.length=0;
  });
  await assert.rejects(f.add(),/changed|Cannot verify/);assert.equal(f.types.test123,'text');assert.equal(f.writes(),0);assert.equal(f.events.size,0);
 }finally{await f.close();}
});
test('a newer queued Table edit after native type write rolls the type back',async()=>{
 const f=await fixture();try{
  const {preset}=await f.table();let once=false;
  f.afterTypeWrite(()=>{if(once)return;once=true;f.queue(preset,{groupBy:'test123'});});
  await assert.rejects(f.add());assert.equal(f.types.test123,'text');assert.equal(f.storage.getSettings().keyMappings.some(m=>m.canonicalKey==='test123'),false);
  assert.equal(f.storage.getCommittedInlinePropertyDefinitions()!.entries.find(e=>e.sourceName==='test123')!.type,'text');assert.equal(f.events.size,0);
 }finally{await f.close();}
});
test('settings save failure restores the old type without publishing a mapping',async()=>{
 const f=await fixture();try{
  await f.table();f.disk.writeFault='throw-before';await assert.rejects(f.add());
  assert.equal(f.types.test123,'text');assert.equal(f.storage.getSettings().keyMappings.some(m=>m.canonicalKey==='test123'),false);assert.equal(f.events.size,0);
 }finally{await f.close();}
});
test('unknown non-text sources are not silently replaced by disk contents',async()=>{
 const f=await fixture();try{
  f.views.push({file:{path:'Unrelated.base',extension:'base'},getViewType:()=> 'unknown-bases'});
  await assert.rejects(f.add(),/Unrelated\.base \[unknown-bases\]/);assert.equal(f.types.test123,'text');assert.equal(f.writes(),0);
 }finally{await f.close();}
});
test('unsaved Markdown property use still prevents changing its type',async()=>{
 const f=await fixture();try{
  f.views.push({file:null,getViewType:()=> 'markdown',editor:{getValue:()=> '{{test123:: unsaved}}'}});
  await assert.rejects(f.add(),/open editor/);assert.equal(f.types.test123,'text');assert.equal(f.writes(),0);
 }finally{await f.close();}
});

for(const viewType of ['markdown',OPERON_TABLE_FILE_VIEW_TYPE])for(const type of ['list','number'] as const)test(`deferred ${viewType} permits unused Text to ${type} without loading tabs`,async()=>{
 const f=await fixture();try{
  const content=viewType==='markdown'?'# Unused source':serializeOperonTableFile(createDefaultTablePreset());
  const {leaf,file}=f.deferred(viewType,content);await f.add(type);
  assert.equal(f.types.test123,type==='list'?'multitext':type);assert.equal(file.content,content);assert.equal(leaf.isDeferred,true);assert.equal(f.events.size,0);
 }finally{await f.close();}
});
for(const content of ['---\ntest123: value\n---\nBody','- [ ] Task {{test123:: value}}'])test(`deferred Markdown still scans persisted usage: ${content.slice(0,12)}`,async()=>{
 const f=await fixture();try{
  f.deferred('markdown',content);await assert.rejects(f.add('list'),/still used in a note/);assert.equal(f.types.test123,'text');assert.equal(f.writes(),0);assert.equal(f.events.size,0);
 }finally{await f.close();}
});
test('fileless Markdown without a deferred leaf remains unverifiable',async()=>{
 const f=await fixture();try{
  f.views.push({getViewType:()=> 'markdown'});await assert.rejects(f.add(),/Cannot verify an open property source: \(unsaved\) \[markdown\]/);assert.equal(f.writes(),0);
 }finally{await f.close();}
});
for(const reader of ['content','throws'] as const)test(`deferred marker never hides an existing Markdown reader: ${reader}`,async()=>{
 const f=await fixture();try{
  const {view}=f.deferred();view.editor={getValue:()=>{if(reader==='throws')throw Error('not ready');return '{{test123:: unsaved}}';}};
  await assert.rejects(f.add(),reader==='throws'?/Cannot verify/:/still used in an open editor/);assert.equal(f.types.test123,'text');assert.equal(f.writes(),0);
 }finally{await f.close();}
});
for(const timing of ['during-scan','after-type-write'] as const)test(`deferred hydration ${timing} invalidates even an empty editor`,async()=>{
 const f=await fixture();try{
  const {view,leaf}=f.deferred();let once=false;
  const hydrate=()=>{if(once)return;once=true;leaf.isDeferred=false;view.getViewData=()=>'';};
  if(timing==='during-scan')f.afterRead(hydrate);else f.afterTypeWrite(hydrate);
  await assert.rejects(f.add());assert.equal(once,true);assert.equal(f.types.test123,'text');assert.equal(f.storage.getSettings().keyMappings.some(m=>m.canonicalKey==='test123'),false);assert.equal(f.events.size,0);
  if(timing==='during-scan')assert.equal(f.writes(),0);else assert.ok(f.writes()>=2,'native type change must be rolled back');
 }finally{await f.close();}
});
test('deferred view replacement with an unsaved editor cancels verification',async()=>{
 const f=await fixture();try{
  const {leaf}=f.deferred();let once=false;f.afterRead(()=>{if(once)return;once=true;leaf.isDeferred=false;leaf.view={leaf,getViewType:()=> 'markdown',editor:{getValue:()=> '{{test123:: unsaved}}'}};f.views[0]=leaf.view;});
  await assert.rejects(f.add(),/changed/);assert.equal(f.writes(),0);assert.equal(f.types.test123,'text');assert.equal(f.events.size,0);
 }finally{await f.close();}
});
test('closing a deferred source during verification cancels the prepared change',async()=>{
 const f=await fixture();try{
  f.deferred();f.afterRead(()=>{f.views.length=0;});await assert.rejects(f.add(),/changed/);assert.equal(f.writes(),0);assert.equal(f.events.size,0);
 }finally{await f.close();}
});
test('unsaved lightbox Markdown usage remains protected',async()=>{
 const f=await fixture();const view={getViewType:()=> 'markdown',editor:{getValue:()=> '{{test123:: unsaved}}'}};const owner=new NativeLightboxLifecycle(f.app,{view} as any);
 try{await assert.rejects(f.add('list'),/still used in an open editor/);assert.equal(f.writes(),0);assert.equal(f.types.test123,'text');}
 finally{owner.dispose();await f.close();}
});

for (const frontmatter of ['other: {{date}} invalid', '"other": [unfinished', "'other': <% template %>", '# empty', '{other: value}']) test(`unrelated readable frontmatter does not block reuse: ${frontmatter}`, () => {
 assert.equal(customKeySourceUses(`---\n${frontmatter}\n---\nBody`,new Set(['test123'])),false);
});
for (const frontmatter of ['test123: [unfinished', '"test123": <% template %>', "'TEST123': {{value}} invalid", 'other: [unfinished\ntest123:', 'other: {{test123:: value}} invalid']) test(`template property use remains protected: ${frontmatter}`, () => {
 assert.equal(customKeySourceUses(`---\n${frontmatter}\n---\nBody`,new Set(['test123'])),true);
});
for (const frontmatter of ['? [complex]\n: [unfinished', '<<: *missing', 'other: [unfinished\n  continuation', '"multi\nline": [unfinished']) test(`ambiguous malformed frontmatter remains blocked: ${frontmatter}`, () => {
 assert.throws(()=>customKeySourceUses(`---\n${frontmatter}\n---\nBody`,new Set(['test123'])));
});
test('template-only YAML errors permit unused type reuse without changing source',async()=>{
 const f=await fixture();try{const {file}=f.deferred('markdown','---\nother: {{date}} invalid\n---\nBody');const before=file.content;await f.add('list');assert.equal(f.types.test123,'multitext');assert.equal(file.content,before);}finally{await f.close();}
});
test('unverifiable persisted frontmatter identifies the file and leaves types unchanged',async()=>{
 const f=await fixture();try{f.deferred('markdown','---\n<<: *missing\n---\nBody');await assert.rejects(f.add(),/Deferred\.md/);assert.equal(f.writes(),0);assert.equal(f.types.test123,'text');}finally{await f.close();}
});

test('imported unindented quoted value remains a value, while later keys are checked',()=>{
 const content='---\nAuthor: "First,\nSecond,\nThird"\ntest123: value\n---\n';
 assert.equal(customKeySourceUses(content,new Set(['unused'])),false);
 assert.equal(customKeySourceUses(content,new Set(['test123'])),true);
});
test('unfinished quoted continuation stays unverifiable',()=>{
 assert.throws(()=>customKeySourceUses('---\nAuthor: "First,\nSecond\nother: value\n---\n',new Set(['test123'])));
});
