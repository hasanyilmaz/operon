import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { TFile } from 'obsidian';
import { DEFAULT_SETTINGS, migrateSettings } from '../src/types/settings';
import { buildOperonDataPackageFromSettings, composeOperonSettingsFromDataPackage } from '../src/storage/operon-data-package';
import { WriteQueue } from '../src/storage/write-queue';
import { TaskUiPreferenceStore } from '../src/storage/task-ui-preference-store';
import { assertSettingsBackupCompatibilityRegistryExhaustive, getSettingsBackupCompatibilityForKey } from '../src/core/settings-backup-compatibility';
import { resolveNativeLightboxLayout } from '../src/ui/native-lightbox-layout';

function methods(file: string, names: string[], dependencies: Record<string, unknown> = {}) {
 const source = readFileSync(file, 'utf8'), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
 const klass = ast.statements.find(node => ts.isClassDeclaration(node) && names.every(name => node.members.some(member => member.name?.getText(ast) === name))) as ts.ClassDeclaration;
 assert.ok(klass);
 const selected = names.map(name => klass.members.find(member => member.name?.getText(ast) === name)!.getText(ast)).join('\n');
 const code = ts.transpileModule(`class Fixture { ${selected} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
 return new Function(...Object.keys(dependencies), `${code}; return Fixture;`)(...Object.values(dependencies));
}
function deferred<T>() { let resolve!: (value:T)=>void; const promise=new Promise<T>(r=>resolve=r); return {promise,resolve}; }
function openingFixture(options: {desktop?:boolean;fileTask?:boolean;excalidraw?:boolean;newTask?:boolean;instance?:boolean;standalone?:boolean}={}) {
 const file=Object.assign(Object.create(TFile.prototype),{path:'A.md',extension:'md'});
 const document={body:{closest:(): {isConnected:boolean}|null=>null}}; const content={destroyed:0,destroy(){this.destroyed++;}};
 const indexed={operonId:'task001',primary:{filePath:'A.md',format:options.fileTask?'yaml':'inline'}};
 let opened:any=null,modal=0;
 const Host=methods('main.ts',['openTaskEditorFor'],{LIGHTBOX_PERF_ENABLED:false,getActiveDocument:()=>document,asHTMLElement:()=>null,getActiveLightboxShell:()=>null,
  Platform:{isDesktopApp:options.desktop!==false},TFile,resolveInlineTaskDescriptionCursorCh:()=>7,
  readTaskEditorMarkdown:async()=>host.buffer ?? 'same',
  openTaskWorkspace:async(...args:any[])=>{await host.beforeWorkspace?.();opened=args;return {content,modalEl:{}};},
  TaskEditorModal:class{open(){modal++;}},
 });
 const host=new Host(); Object.assign(host,{settings:{...DEFAULT_SETTINGS},taskEditorOpeningRequests:new WeakMap(),indexer:{getTask:()=>indexed},app:{vault:{getAbstractFileByPath:()=>file}},
  createTaskEditorContentFor:async()=>content,isExcalidrawTaskSource:()=>!!options.excalidraw,
  readTaskEditorSource:async()=>({file,lineNumber:9,parsed:{},format:indexed.primary.format}),showPluginUiMutationOutcome(){},
 });
 return {host,file,document,content,stats:()=>({opened,modal}),task:options.newTask?null:{operonId:'task001'},instance:options.instance?()=>indexed:undefined};
}
for(const fileTask of [true,false])test(`desktop existing ${fileTask?'file':'inline'} task uses one native workspace with correct initial visibility`,async()=>{
 const f=openingFixture({fileTask});let callback=0;
 await f.host.openTaskEditorFor(f.task,()=>{}, {},undefined,()=>callback++);
 assert.equal(f.stats().modal,0); assert.equal(f.stats().opened[3].markdown,fileTask);assert.equal(callback,1);
 assert.equal(f.stats().opened[2].operonId,'task001');
 if(!fileTask)assert.deepEqual([f.stats().opened[2].line,f.stats().opened[2].caretCh],[9,7]);
});
for(const options of [{desktop:false},{desktop:false,fileTask:true},{excalidraw:true},{newTask:true},{instance:true},{standalone:true,fileTask:true}])test(`excluded entry keeps existing modal: ${JSON.stringify(options)}`,async()=>{
 const f=openingFixture(options);await f.host.openTaskEditorFor(f.task,()=>{}, {},f.instance,undefined,options.standalone);assert.equal(f.stats().modal,1);assert.equal(f.stats().opened,null);
});
test('a late editor preparation cannot replace a newer opening',async()=>{
 const f=openingFixture(),wait=deferred<any>();f.host.createTaskEditorContentFor=()=>wait.promise;
 const first=f.host.openTaskEditorFor(f.task,()=>{}); await Promise.resolve(); f.host.createTaskEditorContentFor=async()=>({destroy(){}});
 await f.host.openTaskEditorFor(f.task,()=>{});const latest=f.stats().opened;
 wait.resolve(f.content);await first;assert.equal(f.stats().opened,latest);assert.equal(f.content.destroyed,1);
});
test('a missing source destroys only the unmounted content without opening a stale pane',async()=>{
 const f=openingFixture();f.host.readTaskEditorSource=async()=>{throw Error('removed');};await f.host.openTaskEditorFor(f.task,()=>{});
 assert.equal(f.content.destroyed,1);assert.equal(f.stats().opened,null);
});
test('opening follows the newly resolved file after a task move',async()=>{
 const f=openingFixture();const moved={path:'Moved.md'};f.host.readTaskEditorSource=async()=>({file:moved,lineNumber:18,parsed:{},format:'inline'});
 await f.host.openTaskEditorFor(f.task,()=>{});assert.equal(f.stats().opened[2].file,moved);assert.equal(f.stats().opened[3].task.file,moved);
});
const Controller=methods('src/ui/native-task-workspace.ts',['prepare','refresh','toggleEditor','setLocked','followSource'],{Notice:class{}});
function controllerFixture(){const c=new Controller();Object.assign(c,{generation:0,disposed:false,locked:false,enabled:true,editorHidden:false,busy:false,
 binding:{},sizeBinding:{},shell:{querySelectorAll:()=>[],ownerDocument:{activeElement:null}},body:{empty(){}},panel:{},
 provider:{resolve:async(file:any)=>({file,operonId:file.id}),create:async()=>({destroy(){}}),confirmDiscard:async()=>false},
 layout(){},mount(task:any,content:any){this.descriptor=task;this.editor=content;},editor:null,
 });return c;}
test('normal source refresh preserves an existing same-ID editor across mode changes and renames',async()=>{
 const c=controllerFixture(),file={id:'A',path:'new.md'},editor={destroy(){throw Error('must keep draft');}};
 Object.assign(c,{descriptor:{operonId:'A',file},editor,explicit:{operonId:'A',file}});
 await c.refresh({view:{getViewType:()=> 'markdown',file}});assert.equal(c.editor,editor);
});
test('late task resolver cannot replace a newer task context',async()=>{
 const c=controllerFixture(),wait=deferred<any>();c.provider.resolve=()=>wait.promise;
 const first=c.refresh({view:{getViewType:()=> 'markdown',file:{id:'A'}}});
 c.provider.resolve=async(file:any)=>({file,operonId:'B'});await c.refresh({view:{getViewType:()=> 'markdown',file:{id:'B'}}});
 wait.resolve({file:{id:'A'},operonId:'A'});await first;assert.equal(c.descriptor.operonId,'B');
});
test('late editor creation after disposal is cleaned up without mounting',async()=>{
 const c=controllerFixture(),wait=deferred<any>();let destroyed=0;c.provider.create=()=>wait.promise;
 const refresh=c.refresh({view:{getViewType:()=> 'markdown',file:{id:'A'}}});await Promise.resolve();c.disposed=true;
 wait.resolve({destroy(){destroyed++;}});await refresh;assert.equal(destroyed,1);assert.equal(c.editor,null);
});
test('source-only and manually hidden sessions resolve context without constructing an editor',async()=>{
 for(const config of [{enabled:false},{editorHidden:true}]){const c=controllerFixture();Object.assign(c,config);c.provider.create=()=>{throw Error('must stay hidden');};await c.refresh({view:{getViewType:()=> 'markdown',file:{id:'B'}}});assert.equal(c.editor,null);assert.equal(c.descriptor.operonId,'B');}
});
test('transition preparation uses existing save result and never opens a discard dialog',async()=>{
 const c=controllerFixture();c.provider.confirmDiscard=()=>{throw Error('no navigation dialog');};
 for(const outcome of [{ok:false,reason:'write-rejected'},{ok:true,clean:false}]){c.editor={prepareCloseSave:async()=>outcome,isEdited:true};assert.equal(await c.prepare(false),false);}
 c.editor={prepareCloseSave:async()=>({ok:true,clean:true}),isEdited:false};assert.equal(await c.prepare(false),true);
});
test('late save outcome cannot approve a different or disposed editor',async()=>{
 const c=controllerFixture(),wait=deferred<any>();c.editor={prepareCloseSave:()=>wait.promise,isEdited:false};const pending=c.prepare();c.editor={};wait.resolve({ok:true,clean:true});assert.equal(await pending,false);
});
test('navigation lock cancels a pending show-editor creation',async()=>{
 const c=controllerFixture(),wait=deferred<any>();let destroyed=0;c.descriptor={operonId:'A',file:{}};c.provider.create=()=>wait.promise;
 const show=c.toggleEditor();c.setLocked(true);wait.resolve({destroy(){destroyed++;}});await show;assert.equal(c.editor,null);assert.equal(destroyed,1);
});
for(const width of [0,1,300,700,1600])test(`geometry never creates a negative panel dimension at viewport ${width}`,()=>{
 const result=resolveNativeLightboxLayout({viewport:{width,height:500},markdown:{width:1200,height:900},companion:{width:600,height:300},margin:24,railWidth:52,side:'right'});
 for(const rect of [result.markdown,result.companion,result.rail])if(rect)assert.ok(rect.width>=0&&rect.height>=0);
 assert.equal(result.fits,width>=701);
});

test('source relocation resolves identity and verifies actual native navigation before accepting the new location',async()=>{
 const c=controllerFixture(),old={path:'old.md'},next={path:'new.md'};
 Object.assign(c,{descriptor:{operonId:'A',file:old},currentFile:old,editor:{},provider:{locate:async()=>({operonId:'A',file:next})},navigate:async()=>{c.currentFile=next;}});
 assert.equal(await c.followSource(),true);assert.equal(c.explicit.file,next);
 c.currentFile=old;c.explicit={operonId:'A',file:old};c.navigate=async()=>{};
 assert.equal(await c.followSource(),false);assert.equal(c.explicit.file,old);
});

test('a slow source load cannot open after a more recent task selection',async()=>{
 const f=openingFixture(),wait=deferred<any>();const first=f.host.openTaskEditorFor(wait.promise,()=>{});
 await f.host.openTaskEditorFor(f.task,()=>{});const latest=f.stats().opened;
 wait.resolve(f.task);await first;assert.equal(f.stats().opened,latest);
});
test('closing the parent during source loading cancels the child opening',async()=>{
 const f=openingFixture(),wait=deferred<any>(),parent={isConnected:true};f.document.body.closest=()=>parent;
 const opening=f.host.openTaskEditorFor(wait.promise,()=>{});parent.isConnected=false;wait.resolve(f.task);await opening;
 assert.equal(f.stats().opened,null);
});

test('created file task editor explicitly keeps the standalone handoff',()=>{
 const source=readFileSync('main.ts','utf8');const start=source.indexOf('if (options.openEditorOnCreate === true)');const block=source.slice(start,source.indexOf('return result;',start));
 assert.match(block,/openYamlTaskEditorByData[\s\S]*true, \/\/ Creation keeps its existing standalone editor handoff/);
});

for (const side of ['left', 'right'] as const) test(`outer source gutter is reserved on ${side} companion layouts`, () => {
 const result = resolveNativeLightboxLayout({ viewport: { width: 1200, height: 900 }, markdown: { width: 1100, height: 750 }, companion: { width: 600, height: 400 }, margin: 24, railWidth: 52, markdownOuterRailWidth: 52, side });
 assert.equal(result.markdown!.width, 448);
 assert.equal(result.rail!.width, 52);
 assert.equal(side === 'right' ? result.markdown!.left : 1200 - result.markdown!.left - result.markdown!.width, 76);
 assert.equal(result.fits, true);
});
test('standalone source reserves both outside rails without changing the requested size', () => {
 const markdown = { width: 1100, height: 750 };
 const result = resolveNativeLightboxLayout({ viewport: { width: 1200, height: 900 }, markdown, companion: null, margin: 24, railWidth: 52, markdownOuterRailWidth: 52, side: 'right' });
 assert.equal(result.markdown!.left, 76); assert.equal(result.markdown!.width, 1048);
 assert.equal(markdown.width, 1100);
});

// Pool admission and checkout use exact native documents, never an index cache.
import { parkNativeLightboxView, takeNativeLightboxView, clearNativeLightboxPool, nativeLightboxDefaults } from '../src/ui/native-lightbox-pool';
function poolFixture() {
 const timers = new Map<number, () => void>(); let next = 0, disposed = 0, clears = 0;
 const doc: any = { defaultView: { setTimeout(fn: () => void, ms: number) { assert.equal(ms, 300000); timers.set(++next, fn); return next; }, clearTimeout(id: number) { timers.delete(id); }, addEventListener() {}, removeEventListener() {} } };
 const file: any = { path: 'task.md' }; let stored = '---\nid: task\n---\nbody';
 const view: any = { file, getViewType: () => 'markdown', getViewData: () => stored, getMode: () => 'source', setViewData(_s: string, clear: boolean) { assert.equal(clear, true); clears++; }, editor: { setCursor() {} }, currentMode: { applyScroll() {} }, setEphemeralState() {} };
 const leaf: any = { view }; const active: any[] = [];
 const app: any = { vault: { read: async () => stored, getAbstractFileByPath: (path: string) => path === file.path ? file : null }, workspace: { getLeavesOfType: () => active } };
 return { app, doc, leaf, file, timers, active, park: () => parkNativeLightboxView(app, doc, leaf, stored, nativeLightboxDefaults(app), () => { disposed++; }), edit: (text: string) => { stored = text; }, stats: () => ({ disposed, clears }) };
}
test('empty native pool returns synchronously without delaying cold opening', () => {
 const f = poolFixture();
 assert.equal(takeNativeLightboxView(f.app, f.doc, f.file), null);
});
test('clean native pool checkout resets history and is exclusive', async () => {
 const f = poolFixture(); assert.equal(f.park(), true);
 assert.equal(await takeNativeLightboxView(f.app, f.doc, f.file), f.leaf);
 assert.equal(await takeNativeLightboxView(f.app, f.doc, f.file), null);
 assert.deepEqual(f.stats(), { disposed: 0, clears: 1 }); assert.equal(f.timers.size, 0);
});
test('pool rejects external edits and conflicting unsaved normal buffers', async () => {
 for (const external of [true, false]) {
  const f = poolFixture(); f.park();
  if (external) f.edit('changed'); else f.active.push({ view: { file: f.file, getViewData: () => 'unsaved' } });
  assert.equal(await takeNativeLightboxView(f.app, f.doc, f.file), null);
  assert.deepEqual(f.stats(), { disposed: 1, clears: 0 });
 }
});
test('pool expires without polling and unload rejects late arrivals', () => {
 const f = poolFixture(); f.park(); [...f.timers.values()][0]();
 assert.equal(f.stats().disposed, 1); assert.equal(f.timers.size, 0);
 f.park(); clearNativeLightboxPool(f.app);
 assert.equal(f.stats().disposed, 2); assert.equal(f.park(), false);
});
test('native pool is bounded to two idle views in each owner window', () => {
 const f = poolFixture(); f.park(); f.park(); f.park();
 assert.equal(f.stats().disposed, 1); assert.equal(f.timers.size, 2);
 clearNativeLightboxPool(f.app, f.doc); assert.equal(f.stats().disposed, 3);
 assert.equal(f.park(), false);
});

for (const changed of [false, true]) test(`opening source reuse validates the current buffer: changed=${changed}`, async () => {
 const f = openingFixture(); let scans = 0; let reader: any;
 const index = f.host.indexer.getTask();
 Object.assign(f.host, { settings: { keyMappings: [] }, getMarkdownViewsForPath: () => [] });
 f.host.indexer.hasDuplicateOperonIdConflict = () => false;
 f.host.readTaskEditorSource = async () => { scans++; return { file: f.file, filePath: f.file.path, task: index, parsed: {}, lineNumber: 0, format: 'inline', sourceText: 'same', sourceIndex: index, sourceMappings: '[]' }; };
 f.host.createTaskEditorContentFor = async (...args: any[]) => { reader = args[5]; return f.content; };
 f.host.beforeWorkspace = async () => { if (changed) f.host.buffer = 'changed'; await reader('task001'); };
 await f.host.openTaskEditorFor(f.task, () => {});
 assert.equal(scans, changed ? 2 : 1);
 await reader('task001'); assert.equal(scans, changed ? 3 : 2, 'opening snapshot is single-use');
});

for (const side of ['left','right'] as const) for (const fileTask of [true,false]) for (const show of [true,false]) {
 test(`opening preferences: ${side}, ${fileTask?'file':'inline'}, source ${show}`,async()=>{
  const f=openingFixture({fileTask}); Object.assign(f.host.settings,{taskEditorPosition:side,taskEditorFileShowSource:show,taskEditorInlineShowSource:show});
  const wait=deferred<any>(); f.host.createTaskEditorContentFor=()=>wait.promise;
  const pending=f.host.openTaskEditorFor(f.task,()=>{});
  await Promise.resolve();
  Object.assign(f.host.settings,{taskEditorPosition:side==='left'?'right':'left',taskEditorFileShowSource:!show,taskEditorInlineShowSource:!show});
  wait.resolve(f.content);await pending;
  assert.equal(f.stats().opened[3].markdown,show);assert.equal(f.stats().opened[3].position,side);
 });
}
test('workspace settings roundtrip through the canonical UI slice and preference store',()=>{
 assertSettingsBackupCompatibilityRegistryExhaustive(DEFAULT_SETTINGS);
 for(const taskEditorPosition of ['left','right'] as const)for(const taskEditorFileShowSource of [true,false])for(const taskEditorInlineShowSource of [true,false]){
  const values={taskEditorPosition,taskEditorFileShowSource,taskEditorInlineShowSource};
  const settings=migrateSettings({...DEFAULT_SETTINGS,...values,taskEditorShowLineNumbers:true,taskEditorHighlightActiveLine:false});
  const pkg=buildOperonDataPackageFromSettings(settings);
  const restored=composeOperonSettingsFromDataPackage(pkg,{...DEFAULT_SETTINGS,taskEditorPosition:'left',taskEditorFileShowSource:false,taskEditorInlineShowSource:true});
  let writes=0; const store=new TaskUiPreferenceStore({} as never,new WriteQueue(),DEFAULT_SETTINGS);store.setPackagePersistence(async()=>{writes++;});store.loadFromPackage(pkg.ui.taskUiPreferences);
  for(const key of Object.keys(values) as (keyof typeof values)[]){
   assert.equal(restored[key],values[key]);assert.equal(store.getAll()[key],values[key]);
   assert.equal((pkg.settings as any)[key],undefined);assert.ok(getSettingsBackupCompatibilityForKey(key));
  }
  assert.equal(restored.taskEditorShowLineNumbers,true);assert.equal(restored.taskEditorHighlightActiveLine,false);assert.equal(writes,0);
 }
});
test('old and malformed workspace preferences retain existing opening defaults without package backfill',()=>{
 for(const raw of [{},{taskEditorPosition:'top',taskEditorFileShowSource:'false',taskEditorInlineShowSource:'true'}]){
  const value=migrateSettings(raw);assert.deepEqual([value.taskEditorPosition,value.taskEditorFileShowSource,value.taskEditorInlineShowSource],['right',true,false]);
 }
 const pkg=buildOperonDataPackageFromSettings(DEFAULT_SETTINGS);
 for(const key of ['taskEditorPosition','taskEditorFileShowSource','taskEditorInlineShowSource'])assert.equal(Object.prototype.hasOwnProperty.call(pkg.ui.taskUiPreferences,key),false);
 const before=JSON.stringify(pkg);composeOperonSettingsFromDataPackage(pkg,DEFAULT_SETTINGS);assert.equal(JSON.stringify(pkg),before);
});
test('settings surfaces expose workspace preferences and retire legacy controls only',()=>{
 const text=readFileSync('src/ui/settings-tab.ts','utf8'), registry=readFileSync('src/ui/settings/settings-search-registry.ts','utf8');
 for(const method of ['buildTaskEditorSettingsItems','renderInterfaceTaskEditorTab']){
  const start=text.indexOf('private '+method+'('),end=text.indexOf('\n\tprivate ',start+1),body=text.slice(start,end);
  for(const key of ['taskEditorPosition','taskEditorFileShowSource','taskEditorInlineShowSource']){assert.ok(body.includes("'"+key+"'"));assert.ok(registry.includes("'interfaceTaskEditor', '"+key+"'"));}
  for(const key of ['taskEditorShowLineNumbers','taskEditorHighlightActiveLine','taskEditorFileBodySection'])assert.equal(body.includes(key),false);
 }
 for(const key of ['taskEditorShowLineNumbers','taskEditorHighlightActiveLine'])assert.equal(registry.includes("'interfaceTaskEditor', '"+key+"'"),false);
});

for (const side of ['left','right'] as const) for (const height of [300,500,900]) test(`hidden source keeps ${side} editor at the source frame top for height ${height}`,()=>{
 const input={viewport:{width:1600,height:1000},companion:{width:600,height:400},side,margin:24,railWidth:52,alignmentHeight:height};
 const paired=resolveNativeLightboxLayout({...input,markdown:{width:1000,height}});
 const editorOnly=resolveNativeLightboxLayout({...input,markdown:null});
 assert.equal(editorOnly.companion!.top,paired.companion!.top);
 assert.equal(editorOnly.companion!.top,(1000-height)/2);
 assert.equal(editorOnly.companion!.height,Math.min(400,height));
 assert.equal(editorOnly.companion!.left,paired.companion!.left);
});
for(const height of [NaN,-10,0,10000])test(`hidden source alignment safely clamps invalid height ${height}`,()=>{
 const result=resolveNativeLightboxLayout({viewport:{width:800,height:600},markdown:null,companion:{width:500,height:1000},side:'right',margin:24,railWidth:52,alignmentHeight:height});
 const panel=result.companion!;
 assert.ok(Number.isFinite(panel.top)&&panel.top>=0);
 assert.ok(panel.height>=0&&panel.top+panel.height<=600);
});
for(const side of ['left','right'] as const)test(`one shared rail releases the unused outside gutter for ${side} layouts`,()=>{
 const result=resolveNativeLightboxLayout({viewport:{width:1200,height:900},markdown:{width:1100,height:750},companion:{width:600,height:400},side,margin:24,railWidth:52});
 assert.equal(result.markdown!.width,500);
 assert.equal(side==='right'?result.markdown!.left:1200-result.markdown!.left-result.markdown!.width,24);
});
