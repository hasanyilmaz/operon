import { TaskWriter } from '../src/core/task-writer';
import { capturePropertyEditorMarkdown } from '../src/ui/task-editor-markdown-source';
import { getNativePropertyIndex } from '../src/indexer/native-property-index';
import { isSupportedRawYamlPropertyValue, rawYamlPropertyExpectationsEqual } from '../src/core/raw-yaml-property';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type * as Typescript from 'typescript';
import { parseYaml, TFile } from 'obsidian';
import { customKeySourceUses, prepareCustomKeyTypeReuse, type CustomKeyReuseOptions } from '../src/ui/custom-key-type-reuse';
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

async function fixture(initialType:KeyMapping['type']='text') {
 const disk = new SettingsPreservationHarness({table:false,inlinePropertyBackups:true});
 const storage = disk.createStorage();
 const app: any = (storage as any).app;
 const adapter = app.vault.adapter;
 const types: Record<string,string> = {};
 let nativeWrites = 0, tableWrites = 0, afterRead = () => {}, afterTypeWrite = () => {};
 const files = new Map<string,any>(), views: any[] = [], events = new Set<unknown>(), eventNames = new Map<unknown,string>();
 app.vault.adapter = {...adapter,
  exists: async(path:string) => path === '.obsidian/types.json' || adapter.exists(path),
  read: async(path:string) => path === '.obsidian/types.json' ? JSON.stringify({types}) : adapter.read(path),
 };
 Object.assign(app.vault, {
  getFiles:()=>[...files.values()], getMarkdownFiles:()=>[...files.values()].filter(f=>f.extension==='md'),
  getAbstractFileByPath:(path:string)=>files.get(path)??null,
  read:async(file:any)=>{const content=file.content;afterRead();return content;},
  on:(event:string,callback:unknown)=>{events.add(callback);eventNames.set(callback,event);return callback;},offref:(callback:unknown)=>{events.delete(callback);eventNames.delete(callback);},
 });
 app.workspace={iterateAllLeaves:(callback:any)=>views.forEach(view=>callback(view.leaf??{view})),getLeavesOfType:()=>[]};
 app.metadataTypeManager={getAssignedWidget:(name:string)=>types[name]??null,setType:async(name:string,type:string)=>{nativeWrites++;types[name]=type;afterTypeWrite();}};
 await storage.initialize();
 const key=(type:KeyMapping['type']='text'):KeyMapping=>({canonicalKey:'test123',visiblePropertyName:'test123',type,enabled:true,sync:'yes',isSystem:false,icon:'star'});
 await storage.saveCustomKeyMapping(key(initialType));types.test123=initialType==='list'?'multitext':initialType;
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
 const add=(type:KeyMapping['type']='number',options:CustomKeyReuseOptions={})=>storage.saveCustomKeyMapping(key(type),{prepare:(settings,writeSource)=>prepareCustomKeyTypeReuse(app,settings,key(type),()=>storage.getSettings(),{...options,writeSource})});
 const queue=(preset:TablePreset,patch:any)=>{const ticket=registry.queuePatch(preset.id,'test',{id:preset.id,...patch});void ticket.settled.catch(()=>{});return ticket;};
 return {disk,storage,app,types,files,views,events,table,deferred,add,queue,registry,
  emit:(name:string,file:any)=>{for(const callback of events)if(eventNames.get(callback)===name)(callback as (file:any)=>void)(file);},
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


async function outlineFixture(content = '') {
 const f = await fixture();
 const file = Object.assign(Object.create(TFile.prototype), { path: 'Documentation.md', extension: 'md', content, stat: { mtime: 1, size: content.length } });
 f.files.set(file.path, file);
 const markdown = { file, getViewType: () => 'markdown', editor: { getValue: () => content } };
 const outline: any = { file, getViewType: () => 'outline' };
 f.views.push(markdown, outline);
 return { ...f, file, markdown, outline };
}
for (const content of ['', '# Documentation\nNo custom fields.']) for (const type of ['list', 'number'] as const) test(`Outline permits unused key reuse with an open note: ${type}, empty=${!content}`, async () => {
 const f = await outlineFixture(content);
 try {
  await f.add(type);
  assert.equal(f.types.test123, type === 'list' ? 'multitext' : type);
  assert.equal(f.storage.getSettings().keyMappings.find(mapping => mapping.canonicalKey === 'test123')?.type, type);
  assert.equal(f.file.content, content);
  assert.equal(f.views.length, 2);
  assert.equal(f.events.size, 0);
 } finally { await f.close(); }
});
for (const content of ['---\ntest123: old\n---\n', '- [ ] Task {{test123:: old}}']) test(`Outline does not hide persisted usage: ${content.slice(0, 12)}`, async () => {
 const f = await outlineFixture(content);
 try {
  const before = f.disk.raw();
  await assert.rejects(f.add(), /still used in a note/);
  assert.equal(f.writes(), 0); assert.equal(f.disk.raw(), before); assert.equal(f.file.content, content);
 } finally { await f.close(); }
});
test('Outline does not hide unsaved Markdown usage', async () => {
 const f = await outlineFixture();
 try {
  f.markdown.editor.getValue = () => '{{test123:: unsaved}}';
  const before = f.disk.raw();
  await assert.rejects(f.add(), /still used in an open editor/);
  assert.equal(f.writes(), 0); assert.equal(f.disk.raw(), before); assert.equal(f.file.content, '');
 } finally { await f.close(); }
});
for (const reader of ['editor', 'getViewData', 'getPropertySourceSnapshot'] as const) test(`Outline with a source reader stays protected: ${reader}`, async () => {
 const f = await outlineFixture();
 try {
  const read = () => '{{test123:: unsaved}}';
  f.outline[reader] = reader === 'editor' ? { getValue: read } : read;
  await assert.rejects(f.add(), reader === 'getPropertySourceSnapshot' ? /Cannot verify/ : /still used in an open editor/);
  assert.equal(f.writes(), 0); assert.equal(f.types.test123, 'text');
 } finally { await f.close(); }
});
test('Outline exemption does not hide unknown Markdown-backed views', async () => {
 const f = await outlineFixture();
 try {
  f.views.push({ file: f.file, getViewType: () => 'unknown-editor' });
  await assert.rejects(f.add(), /Documentation\.md \[unknown-editor\]/);
  assert.equal(f.writes(), 0);
 } finally { await f.close(); }
});
for (const timing of ['during-scan', 'after-type-write'] as const) test(`Outline gaining a source reader invalidates reuse: ${timing}`, async () => {
 const f = await outlineFixture();
 try {
  const change = () => { f.outline.editor = { getValue: () => '{{test123:: unsaved}}' }; };
  if (timing === 'during-scan') f.afterRead(change); else f.afterTypeWrite(change);
  await assert.rejects(f.add(), timing === 'during-scan' ? /changed/ : /Settings operation cancelled/);
  assert.equal(f.types.test123, 'text');
  assert.equal(f.storage.getSettings().keyMappings.some(mapping => mapping.canonicalKey === 'test123'), false);
  assert.equal(f.storage.getCommittedInlinePropertyDefinitions()!.entries.find(entry => entry.sourceName === 'test123')!.type, 'text');
  assert.equal(f.events.size, 0);
  if (timing === 'during-scan') assert.equal(f.writes(), 0); else assert.ok(f.writes() >= 2);
 } finally { await f.close(); }
});

// Real settings coordinator + TaskWriter + native Markdown source port. Only disk/UI are simulated.
function productionMembers(path:string, selected:string[]) {
 const ast=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true);
 const all=ast.statements.filter(ts.isClassDeclaration).flatMap(node=>[...node.members]);
 return selected.map(name=>{const member=all.find(m=>m.name?.getText(ast)===name);assert.ok(member,name);return member.getText(ast);}).join('\n');
}
function conversionWorld(f:Awaited<ReturnType<typeof fixture>>) {
 const writer=new TaskWriter(f.app,{} as any,f.storage.getSettings().keyMappings,{getInlinePropertyDefinitions:()=>f.storage.getCommittedInlinePropertyDefinitions()});
 const Plugin=new Function('capturePropertyEditorMarkdown',ts.transpile(`class Plugin {${productionMembers('main.ts',['writeCustomKeyReuseSource'])}};return Plugin;`,{target:ts.ScriptTarget.ES2022}))(capturePropertyEditorMarkdown);
 const plugin=new Plugin();
 Object.assign(plugin,{app:f.app,writer,indexer:{scheduleReindex(){}},propertyEditorWrittenSources:new WeakMap(),getMarkdownViewsForPath:(path:string)=>f.views.filter(v=>v.file?.path===path&&v.getViewType()==='markdown')});
 let permit:any, writes=0;
 const faults={before:(_file:any)=>{},after:(_file:any)=>{}};
 f.app.vault.process=async(file:any,transform:(text:string)=>string)=>{
  faults.before(file);const next=transform(file.content);file.content=next;file.stat.mtime++;file.stat.size=next.length;writes++;
  f.emit('modify',file);
  faults.after(file);return next;
 };
 f.storage.setMappingMutationCoordinator(operation=>writer.runExclusiveTaskMutation(async p=>{permit=p;try{return await operation();}finally{permit=undefined;}}),mappings=>writer.updateKeyMappings(mappings));
 f.storage.setCustomKeySourceWriter((...args)=>plugin.writeCustomKeyReuseSource(...args,permit));
 function note(content:string,path='Task.md') {
  const file=Object.assign(Object.create(TFile.prototype),{path,extension:'md',content,stat:{mtime:1,ctime:1,size:content.length}});
  f.files.set(path,file);return file;
 }
 function view(file:any,initial=file.content) {
  let text=initial;
  const v={file,getViewType:()=> 'markdown',saving:false,data:file.content,lastSavedData:file.content,
   editor:{getValue:()=>text,offsetToPos:(ch:number)=>({line:0,ch}),transaction:({changes}:any)=>{for(const c of changes)text=text.slice(0,c.from.ch)+c.text+text.slice(c.to.ch);}},
   setText:(value:string)=>{text=value;}};
  f.views.push(v);return v;
 }
 const add=(type:KeyMapping['type']='list',confirm:NonNullable<CustomKeyReuseOptions['confirm']>=async()=>true)=>f.add(type,{confirm});
 return {writer,plugin,note,view,add,faults,writes:()=>writes};
}
const emptyNote='---\noperonId: ABC1234\nBefore: keep\ntest123: [] # keep comment\nAfter: 0\nUpdated: 2026-11-01T12:00\n---\nBody stays.\n';

test('reporter flow: actual editor Clear retains List key; recreate Text preserves order and permits Text editing',async()=>{
 const f=await fixture('list');try{
  const w=conversionWorld(f);
  // Re-add the original type so the production editor/writer see the original mapping.
  await f.add('list');
  const original=emptyNote.replace('[] # keep comment','[old]');
  const Editor=new Function('isSupportedRawYamlPropertyValue','rawYamlPropertyExpectationsEqual',ts.transpile(`class Editor {${productionMembers('src/ui/task-editor-content.ts',['setFilePropertyValue','getFilePropertyChanges'])}};return Editor;`,{target:ts.ScriptTarget.ES2022}))(isSupportedRawYamlPropertyValue,rawYamlPropertyExpectationsEqual);
  const e=new Editor();Object.assign(e,{settings:f.storage.getSettings(),fileProperties:new Map([['test123',{baseline:{present:true,value:['old']},value:['old'],field:{type:'list'}}]]),canEditFileProperty:()=>true,isNativeCustomProperty:()=>true,refreshFilePropertyValue(){},markEdited(){}});
  e.setFilePropertyValue('test123',[]);
  const cleared=(w.writer as any).renderFilePropertyDraft(original,'ABC1234',{}, {changes:e.getFilePropertyChanges()},'merge',1);
  assert.ok(cleared);assert.deepEqual(parseYaml(cleared.split('---')[1]).test123,[]);
  const file=w.note(cleared);const open=w.view(file);const order=Object.keys(parseYaml(cleared.split('---')[1]));
  await f.storage.saveCustomKeyMapping(f.storage.getSettings().keyMappings.find(m=>m.canonicalKey==='test123')!,{remove:true});
  let prompts=0;
  await w.add('text',async(changes,old,next)=>{prompts++;assert.deepEqual(old,['list']);assert.equal(next,'text');assert.equal(changes.length,1);return true;});
  assert.equal(prompts,1);assert.equal(w.writes(),1);assert.equal(f.types.test123,'text');
  const frontmatter=parseYaml(file.content.split('---')[1]);assert.equal(frontmatter.test123,null);assert.deepEqual(Object.keys(frontmatter),order);
  assert.equal(frontmatter.Updated,'2026-11-01T12:00');assert.ok(file.content.endsWith('Body stays.\n'));assert.equal(open.editor.getValue(),file.content);
  assert.equal(f.storage.getCommittedInlinePropertyDefinitions()!.entries.find(e=>e.sourceName==='test123')!.type,'text');
  const typed=(w.writer as any).renderFilePropertyDraft(file.content,'ABC1234',{}, {changes:[{propertyName:'test123',nativeType:'text',expected:{present:true,value:null},value:'new text'}]},'merge',1);
  assert.ok(typed);assert.equal(parseYaml(typed.split('---')[1]).test123,'new text');
  const source=await capturePropertyEditorMarkdown(f.app,file,()=>[open as any]);
  const result=await w.writer.runExclusiveTaskMutation(permit=>w.writer.withMarkdownSource(source,()=>w.writer.applyExactMarkdownSourceMutation(file.path,file.content,typed,()=>true,permit,'plugin')));
  assert.equal(result.outcome,'committed');assert.equal(parseYaml((await f.app.vault.read(file)).split('---')[1]).test123,'new text');assert.equal(open.editor.getValue(),file.content);
  const backups=f.disk.operations.filter(op=>op.kind==='write'&&op.path.includes('custom-key-reuse-')&&!op.path.endsWith('.result.json'));
  assert.equal(backups.length,1);assert.equal(JSON.parse(await f.app.vault.adapter.read(backups[0].path)).files[0].before,cleared);
  assert.equal(JSON.parse(await f.app.vault.adapter.read(backups[0].path+'.result.json')).status,'committed');
 }finally{await f.close();}
});
for(const value of ['[]','""','null',''])test(`empty value ${value} preserves comments, CRLF, BOM and a clean source`,async()=>{
 const f=await fixture();try{const w=conversionWorld(f);const before='\uFEFF'+emptyNote.replace('[]',value).replace(/\n/gu,'\r\n');const file=w.note(before);w.view(file);
  await w.add();assert.equal(f.types.test123,'multitext');assert.ok(file.content.includes('# keep comment'));assert.ok(file.content.startsWith('\uFEFF'));assert.ok(!/(?<!\r)\n/u.test(file.content));
  if(value==='null'||value==='')assert.equal(file.content,before);else assert.equal(file.content,before.replace(value+' # keep comment','# keep comment'));
 }finally{await f.close();}
});
for(const value of ['[one]','false','0','" "','{}','[""]','&anchor []'])test(`nonempty or unsafe value stays protected: ${value}`,async()=>{
 const f=await fixture();try{const w=conversionWorld(f);const file=w.note(emptyNote.replace('[]',value));const before=file.content;const operations=f.disk.operations.length;
  await assert.rejects(w.add(),/still used/);assert.equal(file.content,before);assert.equal(w.writes(),0);assert.equal(f.writes(),0);assert.equal(f.disk.operations.length,operations);
 }finally{await f.close();}
});
for(const content of [emptyNote+'{{test123:: }}',emptyNote.replace('test123: []','test123: []\nTEST123: []'),emptyNote.replace('test123: []','test123: [broken')])test('inline, ambiguous aliases and malformed YAML remain protected',async()=>{
 const f=await fixture();try{const w=conversionWorld(f);w.note(content);await assert.rejects(w.add());assert.equal(w.writes(),0);assert.equal(f.writes(),0);}finally{await f.close();}
});
test('same type recreation never changes source or asks for conversion',async()=>{
 const f=await fixture();try{const w=conversionWorld(f);const file=w.note(emptyNote);await w.add('text',async()=>{throw Error('unexpected prompt');});assert.equal(file.content,emptyNote);assert.equal(w.writes(),0);}finally{await f.close();}
});
test('already assigned desired native type still reconciles retained definition and empty source',async()=>{
 const f=await fixture('list');try{const w=conversionWorld(f);const file=w.note(emptyNote);f.types.test123='text';await w.add('text');assert.equal(parseYaml(file.content.split('---')[1]).test123,null);assert.equal(f.writes(),0);}finally{await f.close();}
});
test('cancel is zero-write including backups and type registry',async()=>{
 const f=await fixture();try{const w=conversionWorld(f);const file=w.note(emptyNote);const count=f.disk.operations.length;await assert.rejects(w.add('list',async()=>false),/cancelled/);assert.equal(file.content,emptyNote);assert.equal(w.writes(),0);assert.equal(f.writes(),0);assert.equal(f.disk.operations.length,count);}finally{await f.close();}
});
test('dirty native buffer and related editor draft block before conversion',async()=>{
 const f=await fixture();try{const w=conversionWorld(f);const file=w.note(emptyNote);const v=w.view(file,emptyNote+'unsaved');await assert.rejects(w.add(),/Save the open/);
  v.setText(file.content);const unsubscribe=getNativePropertyIndex(f.app).observeDraftProperties(()=>['test123']);
  await assert.rejects(w.add(),/open editor/);unsubscribe();assert.equal(w.writes(),0);assert.equal(f.writes(),0);
 }finally{await f.close();}
});
for(const change of ['content','rename','type'] as const)test(`change during confirmation aborts without writes: ${change}`,async()=>{
 const f=await fixture();try{const w=conversionWorld(f);const file=w.note(emptyNote);await assert.rejects(w.add('list',async()=>{if(change==='content')file.content+='external';else if(change==='rename')file.path='Moved.md';else f.types.test123='checkbox';return true;}));assert.equal(w.writes(),0);assert.equal(f.writes(),0);}finally{await f.close();}
});
for(const fault of ['backup','source','settings'] as const)test(`failure at ${fault} keeps old interpretation and restores owned sources`,async()=>{
 const f=await fixture();try{const w=conversionWorld(f);const a=w.note(emptyNote);const b=w.note(emptyNote,'Second.md');
  if(fault==='backup'){const write=f.app.vault.adapter.write;f.app.vault.adapter.write=async(path:string,text:string)=>{if(path.includes('custom-key-reuse-'))throw Error('backup failure');return write(path,text);};}
  if(fault==='source'){w.faults.before=file=>{if(file===b)throw Error('source failure');};}
  if(fault==='settings')f.disk.writeFault='throw-before';
  await assert.rejects(w.add());assert.equal(a.content,emptyNote);assert.equal(b.content,emptyNote);assert.equal(f.types.test123,'text');assert.equal(f.storage.getSettings().keyMappings.some(m=>m.canonicalKey==='test123'),false);
  assert.equal(f.events.size,0);
 }finally{await f.close();}
});
test('external edit after first write is preserved during conditional rollback',async()=>{
 const f=await fixture();try{const w=conversionWorld(f);const a=w.note(emptyNote);const b=w.note(emptyNote,'Second.md');w.faults.before=file=>{if(file===b){a.content+='external edit';a.stat.mtime++;throw Error('second failure');}};
  await assert.rejects(w.add(),/recovery/);assert.ok(a.content.endsWith('external edit'));assert.equal(b.content,emptyNote);assert.equal(f.types.test123,'text');
 }finally{await f.close();}
});
test('lost source acknowledgement is verified without repeating a committed write',async()=>{
 const f=await fixture();try{const w=conversionWorld(f);w.note(emptyNote);w.faults.after=()=>{throw Error('lost acknowledgement');};await w.add();assert.equal(w.writes(),1);assert.equal(f.types.test123,'multitext');}finally{await f.close();}
});
test('uncertain native type write retains neutral source plus recovery evidence',async()=>{
 const f=await fixture();try{const w=conversionWorld(f);const file=w.note(emptyNote);f.afterTypeWrite(()=>{throw Error('lost type acknowledgement');});await assert.rejects(w.add(),/recovery/);assert.equal(parseYaml(file.content.split('---')[1]).test123,null);assert.equal(f.storage.getSettings().keyMappings.some(m=>m.canonicalKey==='test123'),false);
  const record=f.disk.operations.filter(op=>op.kind==='write'&&op.path.endsWith('.result.json')).at(-1)!;assert.equal(JSON.parse(await f.app.vault.adapter.read(record.path)).status,'recovery-required');
 }finally{await f.close();}
});

test('same-stat external modify after native type write cannot be mistaken for our source write',async()=>{
 const f=await fixture();try{const w=conversionWorld(f);const file=w.note(emptyNote);let once=false;
  f.afterTypeWrite(()=>{if(once)return;once=true;file.content=file.content.replace('test123: # keep comment','test123: x# keep commen');f.emit('modify',file);});
  await assert.rejects(w.add(),/recovery/);assert.ok(file.content.includes('x# keep commen'));assert.equal(f.types.test123,'text');assert.equal(f.storage.getSettings().keyMappings.some(m=>m.canonicalKey==='test123'),false);
 }finally{await f.close();}
});
for(const action of ['delete','rename'] as const)test(`file ${action} during write prevents a type commit`,async()=>{
 const f=await fixture();try{const w=conversionWorld(f);const file=w.note(emptyNote);w.faults.after=()=>{if(action==='delete')f.files.delete(file.path);else file.path='Renamed.md';f.emit(action,file);};await assert.rejects(w.add(),/recovery/);assert.equal(f.types.test123,'text');assert.equal(f.storage.getSettings().keyMappings.some(m=>m.canonicalKey==='test123'),false);}finally{await f.close();}
});
test('backup verification failure leaves all sources and settings untouched',async()=>{
 const f=await fixture();try{const w=conversionWorld(f);const file=w.note(emptyNote);const read=f.app.vault.adapter.read;f.app.vault.adapter.read=async(path:string)=>path.includes('custom-key-reuse-')?'corrupt':read(path);await assert.rejects(w.add(),/backup/);assert.equal(file.content,emptyNote);assert.equal(w.writes(),0);assert.equal(f.writes(),0);}finally{await f.close();}
});
test('durable preimage is present before the first write and a pending record never triggers replay',async()=>{
 const f=await fixture();try{const w=conversionWorld(f);const file=w.note(emptyNote);let beforeBackup='';w.faults.before=()=>{const backup=f.disk.operations.find(op=>op.kind==='write'&&op.path.includes('custom-key-reuse-')&&!op.path.endsWith('.result.json'));assert.ok(backup);beforeBackup=backup.path;throw Error('interrupted before write');};await assert.rejects(w.add());assert.equal(file.content,emptyNote);assert.equal(JSON.parse(await f.app.vault.adapter.read(beforeBackup)).files[0].before,emptyNote);assert.equal(f.writes(),0);assert.equal(w.writes(),0);}finally{await f.close();}
});

for(const value of ['[kept]','0','false'])test(`spaced YAML fence cannot bypass populated-value guard: ${value}`,async()=>{
 const f=await fixture();try{const w=conversionWorld(f);w.note(`--- \ntest123: ${value}\n--- \nBody`);await assert.rejects(w.add(),/still used/);assert.equal(w.writes(),0);assert.equal(f.writes(),0);}finally{await f.close();}
});
test('spaced YAML fences permit empty-only conversion and preserve fence bytes',async()=>{
 const f=await fixture();try{const w=conversionWorld(f);const file=w.note('--- \ntest123: []\n--- \nBody');await w.add();assert.equal(file.content,'--- \ntest123:\n--- \nBody');}finally{await f.close();}
});
test('postcommit evidence failure reports saved state and leaves the new mapping usable',async()=>{
 const f=await fixture();try{const w=conversionWorld(f);const file=w.note(emptyNote);const write=f.app.vault.adapter.write;f.app.vault.adapter.write=async(path:string,text:string)=>{if(path.endsWith('.result.json')&&JSON.parse(text).status==='committed')throw Error('record unavailable');return write(path,text);};
  let warning='';const key={canonicalKey:'test123',visiblePropertyName:'test123',type:'list',enabled:true,sync:'yes',isSystem:false,icon:'star'} as KeyMapping;
  await f.storage.saveCustomKeyMapping(key,{onCommittedWarning:message=>{warning=message;},prepare:(settings,writeSource)=>prepareCustomKeyTypeReuse(f.app,settings,key,()=>f.storage.getSettings(),{writeSource,confirm:async()=>true})});
  assert.match(warning,/was saved/);assert.equal(f.types.test123,'multitext');assert.equal(parseYaml(file.content.split('---')[1]).test123,null);assert.equal(f.storage.getSettings().keyMappings.find(m=>m.canonicalKey==='test123')!.type,'list');
 }finally{await f.close();}
});

test('old types on disk do not prove rollback when the native manager write is uncertain',async()=>{
 const f=await fixture();try{const w=conversionWorld(f);const file=w.note(emptyNote);const read=f.app.vault.adapter.read;let failed=false;
  f.app.vault.adapter.read=async(path:string)=>path==='.obsidian/types.json'&&failed?JSON.stringify({types:{test123:'text'}}):read(path);
  f.app.metadataTypeManager.setType=async(name:string,type:string)=>{f.types[name]=type;failed=true;throw Error('native save failed before disk flush');};
  await assert.rejects(w.add(),/recovery/);assert.equal(parseYaml(file.content.split('---')[1]).test123,null);assert.equal(f.storage.getSettings().keyMappings.some(m=>m.canonicalKey==='test123'),false);
 }finally{await f.close();}
});


test('external settings change retains user data and reports unresolved conversion evidence',async()=>{
 const f=await fixture();try{const w=conversionWorld(f);const file=w.note(emptyNote);let external='';
  f.afterTypeWrite(()=>{external=f.disk.raw()+' ';f.disk.seed(f.disk.canonicalPath,external);});
  await assert.rejects(w.add(),/needs recovery: settings.*Backup:/);
  assert.equal(f.disk.raw(),external);assert.equal(parseYaml(file.content.split('---')[1]).test123,null);
  const record=f.disk.operations.filter(op=>op.kind==='write'&&op.path.endsWith('.result.json')).at(-1)!;
  const evidence=JSON.parse(await f.app.vault.adapter.read(record.path));assert.equal(evidence.status,'recovery-required');assert.ok(evidence.unresolved.includes('Operon settings'));
 }finally{await f.close();}
});
