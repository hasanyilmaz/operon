import { exportOperonSettingsBackupJsonV1 } from '../src/core/settings-backup-export';
import { parseOperonSettingsBackupV1 } from '../src/core/settings-backup-format';
import { getSettingsBackupCompatibilityForKey } from '../src/core/settings-backup-compatibility';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { TFile } from 'obsidian';
import { DEFAULT_SETTINGS, normalizeTaskAfterCreateAction, type TaskAfterCreateAction } from '../src/types/settings';
import { OPERON_SETTINGS_SEARCH_REGISTRY } from '../src/ui/settings/settings-search-registry';
import { SettingsPreservationHarness } from './test-support/settings-preservation-harness';
const ts: typeof import('typescript') = createRequire(`${process.cwd()}/package.json`)('typescript');
function extract(names: string[], dependencies: Record<string, unknown>, file = 'main.ts', className = 'OperonPlugin') {
 const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
 const cls = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className) as import('typescript').ClassDeclaration;
 const members = cls.members.filter(member => ts.isMethodDeclaration(member) && !!member.body && names.includes(member.name.getText(ast)));
 assert.equal(members.length, names.length);
 const code = ts.transpileModule(`class Harness { ${members.map(member => member.getText(ast)).join('\n')} }; return Harness;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
 return new Function(...Object.keys(dependencies), code)(...Object.values(dependencies));
}
function fixture(action: TaskAfterCreateAction, createType: 'file' | 'inline' = 'file') {
 const document: any = { defaultView: { closed: false } }; document.body = { isConnected: true, ownerDocument: document };
 const file = Object.assign(Object.create(TFile.prototype), {path:'Created.md',extension:'md'});
 const calls: any[] = [], notices: string[] = []; let lifecycle = 'ready', duplicate = false, exists = true;
 let beforeLoad = async () => {}; let beforeSource = async () => {};
 const origin = { id: 'original-window-leaf' };
 const Host = extract(['captureTaskAfterCreate'], {
  normalizeTaskAfterCreateAction, TFile, resolveInlineTaskDescriptionCursorCh:()=>13,
  lightboxFileState:(target:any)=>({cursor:{from:{line:target.line,ch:target.caretCh},to:{line:target.line,ch:target.caretCh}},scroll:target.line,focus:true}), Platform: { isDesktopApp: true },
  getLightboxOwnerLeaf: (_app: unknown, doc: unknown) => { assert.equal(doc, document); return origin; },
  prepareLightboxTab: async (_app: unknown, doc: unknown, load: (leaf: any) => Promise<void>, placement: string, owner: unknown) => {
   calls.push(['prepare', doc, placement, owner]); await beforeLoad();
   await load({openFile: async (f: unknown, options: unknown) => { calls.push(['load', f, options]); }});
   return () => calls.push(['activate']);
  },
  openFileLightbox: (_app: unknown, anchor: unknown, target: unknown, current: () => boolean) => calls.push(['source',anchor,target,current]),
  Notice: class { constructor(message: string) { notices.push(message); } }, t: (_namespace: string, key: string) => key,
 });
 const host = Object.assign(new Host(), { settings: {...DEFAULT_SETTINGS,fileTaskAfterCreate:action,inlineTaskAfterCreate:action},creatorOpenGeneration:4,
  agentRuntimeLifecycle: { getPhase: () => lifecycle }, app: { vault: { getAbstractFileByPath: () => exists ? file : null } },
  indexer: { getTask: () => ({ primary: { format: createType === 'file' ? 'yaml' : 'inline', filePath: 'Created.md' } }), hasDuplicateOperonIdConflict: () => duplicate },
  readTaskEditorSource:async()=>{await beforeSource();return {file,format:'inline',lineNumber:7,parsed:{}};},
  openEditorForId: async (...args: any[]) => { calls.push(['editor',...args]); }, navigateToTask: () => calls.push(['mobile']),
 });
 const created:any = createType === 'file' ? { file, fieldValues: { operonId:'task001' } } : {operonId:'task001',filePath:'Created.md',lineNumber:1};
 const open = host.captureTaskAfterCreate(document.body,4,createType);
 return {host,document,file,created,open,calls,notices,origin,beforeSource:(fn:()=>Promise<void>)=>{beforeSource=fn;},duplicate:()=>{duplicate=true;},remove:()=>{exists=false;},unload:()=>{lifecycle='unloading';},beforeLoad:(fn:()=>Promise<void>)=>{beforeLoad=fn;}};
}
for (const action of ['none','new-tab','background-tab','source','source-and-editor','editor'] as const) test(`Creator completion uses the selected File Task opening action: ${action}`, async () => {
 const f = fixture(action); await f.open(f.created); assert.deepEqual(f.notices,[]);
 if (action === 'none') assert.deepEqual(f.calls,[]);
 if (action === 'new-tab' || action === 'background-tab') {
  assert.deepEqual(f.calls[0],['prepare',f.document,'tab',f.origin]);
  assert.deepEqual(f.calls[1],['load',f.file,{active:false}]);
  assert.equal(f.calls.some(call=>call[0]==='activate'),action==='new-tab');
 }
 if (action === 'source') { assert.equal(f.calls[0][0],'source'); assert.equal(f.calls[0][1],f.document.body); assert.equal(f.calls[0][2].operonId,'task001'); assert.equal(f.calls[0][3](),true); }
 if (action === 'source-and-editor') { assert.deepEqual(f.calls[0].slice(0,4),['editor','task001',true,f.document.body]); assert.equal(f.calls[0][4](),true); }
 if (action === 'editor') assert.deepEqual(f.calls[0].slice(0,4),['editor','task001',false,f.document.body]);
});
for (const condition of ['new-creator','closed-window','detached-body','unload']) test(`stale Creator opening is skipped: ${condition}`, async () => {
 const f = fixture('source-and-editor');
 if (condition==='new-creator') f.host.creatorOpenGeneration++;
 if (condition==='closed-window') f.document.defaultView.closed=true;
 if (condition==='detached-body') f.document.body.isConnected=false;
 if (condition==='unload') f.unload();
 await f.open(f.created);assert.deepEqual(f.calls,[]);assert.deepEqual(f.notices,[]);
});
for (const change of ['new-creator','unload']) test(`focused tab cannot activate after asynchronous ${change}`, async () => {
 const f = fixture('new-tab'); f.beforeLoad(async()=>{if(change==='unload')f.unload();else f.host.creatorOpenGeneration++;});
 await f.open(f.created); assert.equal(f.calls.some(call=>call[0]==='activate'),false);assert.deepEqual(f.notices,[]);
});
for (const failure of ['missing-file','duplicate-id','view-failure']) test(`opening failure preserves the created task and reports it: ${failure}`, async () => {
 const f = fixture(failure==='view-failure'?'new-tab':'source');
 if(failure==='missing-file')f.remove();if(failure==='duplicate-id')f.duplicate();
 if(failure==='view-failure')f.beforeLoad(async()=>{throw Error('view unavailable');});
 await f.open(f.created);assert.deepEqual(f.notices,['createdFileTaskOpenFailed']);assert.equal(f.created.file,f.file);
});

test('Settings Search exposes exactly six choices in the existing File Task defaults group', () => {
 const entry=OPERON_SETTINGS_SEARCH_REGISTRY.find(item=>item.key==='fileTaskAfterCreate');assert.ok(entry);assert.equal(entry.tabId,'tasksFileTasks');assert.equal(entry.control,'dropdown');
 const Tab=extract(['getSettingsSearchDropdownOptions','buildTaskCaptureSearchSections'],{t:(_namespace:string,key:string)=>key,isTaskCardSetting:()=>false},'src/ui/settings-tab.ts','OperonSettingsTab');
 const tab:any=new Tab();tab.settings={...DEFAULT_SETTINGS};tab.isCalendarSidebarDefaultStateSettingKey=()=>false;
 const options=tab.getSettingsSearchDropdownOptions('fileTaskAfterCreate');assert.deepEqual(Object.keys(options),['none','source','source-and-editor','editor','new-tab','background-tab']);
 assert.equal(DEFAULT_SETTINGS.fileTaskAfterCreate,'none');
 tab.buildTaskSettingsGroups=(groups:unknown)=>groups;
 const groups=tab.buildTaskCaptureSearchSections('tasksInlineTasks',OPERON_SETTINGS_SEARCH_REGISTRY.filter(item=>item.tabId==='tasksInlineTasks'));
 assert.equal(groups[0][0],'newInlineTaskCreationDefaults');
 assert.equal(JSON.parse(readFileSync('i18n/locales/en.json','utf8')).settings.newInlineTaskCreationDefaults,'New Inline Task Creation Defaults');
 assert.equal(normalizeTaskAfterCreateAction('unknown'),'none');
 const source=readFileSync('src/ui/settings-tab.ts','utf8');assert.match(source,/newFileTaskCreationDefaults[^\n]*fileTaskAfterCreate/u);
});

for (const key of ['fileTaskAfterCreate','inlineTaskAfterCreate'] as const) test(`native Settings/Search ${key} saves atomically and retains old memory on rejection`, async () => {
 const disk=new SettingsPreservationHarness({table:false});
 try {
  const storage=disk.createStorage();await storage.initialize();const settings=storage.getSettings();
  const Tab=extract(['setControlValue'],{normalizeTaskAfterCreateAction},'src/ui/settings-tab.ts','OperonSettingsTab');
  const tab:any=new Tab();Object.assign(tab,{storage,settings,notifySettingsChanged(){},updateNativeSettingsDefinitions(){}});
  await tab.setControlValue(key,'source');assert.equal(settings[key],'source');
  disk.writeFault='throw-before';await assert.rejects(tab.setControlValue(key,'background-tab'));
  assert.equal(settings[key],'source');assert.equal(disk.package().ui.taskCreationProfile[key],'source');
 }finally{await disk.dispose();}
});

for (const boundary of ['content','source']) test(`paired editor discards prepared content after a newer Creator during ${boundary}`, async () => {
 let current=true,destroyed=0,mounted=0; const file=Object.assign(Object.create(TFile.prototype),{path:'Created.md',extension:'md'});
 const document:any={body:{closest:()=>null}};
 const Host=extract(['openTaskEditorFor'],{Platform:{isDesktopApp:true},LIGHTBOX_PERF_ENABLED:false,TFile,getActiveDocument:()=>document,asHTMLElement:()=>null,getActiveLightboxShell:()=>null,
  openTaskWorkspace:async()=>{mounted++;return null;}});
 const task={operonId:'task001',primary:{filePath:'Created.md'}};
 const host=Object.assign(new Host(),{settings:DEFAULT_SETTINGS,taskEditorOpeningRequests:new WeakMap(),indexer:{getTask:()=>task},app:{vault:{getAbstractFileByPath:()=>file}},isExcalidrawTaskSource:()=>false,
  createTaskEditorContentFor:async()=>{if(boundary==='content')current=false;return{destroy:({skipCloseSave}:{skipCloseSave:boolean})=>{assert.equal(skipCloseSave,true);destroyed++;}};},
  readTaskEditorSource:async()=>{current=false;return{file,format:'yaml'};},
 });
 await host.openTaskEditorFor(task,()=>{},{},undefined,undefined,false,true,undefined,()=>current);
 assert.equal(mounted,0);assert.equal(destroyed,1);
});


test('automatic editor focus timers stop when a newer Creator takes ownership', () => {
 const callbacks:Array<()=>void>=[];let focused=0,allowed=true;
 const Host=extract(['applyInitialDescriptionFocus'],{setWindowTimeout:(callback:()=>void)=>{callbacks.push(callback);return callbacks.length;}},'src/ui/task-editor-content.ts','TaskEditorContent');
 const host=Object.assign(new Host(),{isNewTask:false,focusDescriptionOnMount:true,initialDescriptionFocusTimers:[],clearInitialDescriptionFocusTimers(){this.initialDescriptionFocusTimers=[];},focusDescriptionField(){focused++;return true;}});
 host.canFocusInitialDescription=()=>allowed;host.applyInitialDescriptionFocus();assert.equal(callbacks.length,6);allowed=false;
 for(const callback of callbacks)callback();assert.equal(focused,0);assert.equal(host.initialDescriptionFocusTimers.length,0);
});

test('native lightbox rejects an obsolete Creator before allocating its editor or view',async()=>{
 const text=readFileSync('src/ui/web-lightbox.ts','utf8');const ast=ts.createSourceFile('native.ts',text,ts.ScriptTarget.Latest,true);
 const declaration=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='openNativeLightbox')!;
 const js=ts.transpileModule(declaration.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const open=new Function(`${js};return openNativeLightbox;`)();let disposed=0;
 const result=await open({}, {}, {}, {content:{destroy:(options:unknown)=>{assert.deepEqual(options,{skipCloseSave:true});disposed++;}}},()=>false);
 assert.equal(result,null);assert.equal(disposed,1);
});


test('opening hook is limited to prepared Creator and both file finalization routes', () => {
 const source=readFileSync('main.ts','utf8');
 const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);const cls=ast.statements.find(ts.isClassDeclaration)!;
 const body=(name:string)=>cls.members.find(member=>member.name?.getText(ast)===name)!.getText(ast);
 for(const name of ['createCalendarFileTaskFromCreatorDraft','createKanbanFileTaskFromCreatorDraft','startFileTaskCreationFromCreatorDraft','promptTrackerTaskCreation','openSurfaceTaskCreator']) {
  assert.match(body(name),/createFileTaskFromCreatorDraft/u);
 }
 for(const name of ['createFileTaskFromCreatorDraft','createFileSubtaskFromCreatorDraft'])assert.match(body(name),/prepared\.createdFileTask = created/u);
 assert.equal((source.match(/captureTaskAfterCreate\(/gu)||[]).length,2,'only definition and Creator submission may own the opening effect');
 assert.doesNotMatch(body('createPreparedFileTask'),/openFileLightbox|openEditorForId|captureTaskAfterCreate/u);
});


for (const key of ['fileTaskAfterCreate','inlineTaskAfterCreate'] as const) test(`${key} is portable in the existing settings backup format`, async () => {
 assert.ok(getSettingsBackupCompatibilityForKey(key));
 const exported=await exportOperonSettingsBackupJsonV1({settings:{...DEFAULT_SETTINGS,[key]:'editor'},source:{pluginVersion:'4.2.0',obsidianVersion:'1.15.0',dataPackageSchemaVersion:2},createdAt:'2026-10-25T12:00:00.000Z'});
 assert.equal(exported.ok,true);if(!exported.ok)return;
 assert.equal(parseOperonSettingsBackupV1(exported.json).ok,true);
 assert.equal(JSON.parse(exported.json).body.groups.general.data[key],'editor');
});


test('a restored Creator draft also keeps focus when its generation did not change', async () => {
 const f=fixture('source-and-editor');
 f.host.taskCreatorModal={isCreatorSessionOpen:true,containerEl:{}};
 await f.open(f.created);assert.deepEqual(f.calls,[]);assert.deepEqual(f.notices,[]);
});


test('background creation can open its tab while a newer Creator keeps foreground focus', async () => {
 const f=fixture('background-tab');f.host.creatorOpenGeneration++;
 f.host.taskCreatorModal={isCreatorSessionOpen:true,containerEl:{}};
 await f.open(f.created);assert.equal(f.calls.some(call=>call[0]==='load'),true);
 assert.equal(f.calls.some(call=>call[0]==='activate'),false);assert.deepEqual(f.notices,[]);
});

for (const action of ['none','source','source-and-editor','editor','new-tab','background-tab'] as const) test(`Inline Creator completion opens its source or editor: ${action}`, async () => {
 const f=fixture(action,'inline'); await f.open(f.created); assert.deepEqual(f.notices,[]);
 if(action==='none') assert.deepEqual(f.calls,[]);
 else if(action==='editor'||action==='source-and-editor') assert.deepEqual(f.calls[0].slice(0,4),['editor','task001',action==='source-and-editor',f.document.body]);
 else if(action==='source') {assert.equal(f.calls[0][0],'source');assert.equal(f.calls[0][2].file,f.file);assert.equal(f.calls[0][2].line,7);assert.equal(f.calls[0][2].caretCh,13);}
 else {
  assert.deepEqual(f.calls[0],['prepare',f.document,'tab',f.origin]);
  assert.deepEqual(f.calls[1],['load',f.file,{active:false,eState:{cursor:{from:{line:7,ch:13},to:{line:7,ch:13}},scroll:7,focus:false}}]);
  assert.equal(f.calls.some(c=>c[0]==='activate'),action==='new-tab');
 }
});
for(const change of ['new-creator','unload','closed-window'] as const) test(`Inline source preparation cancels stale opening: ${change}`,async()=>{
 const f=fixture('source','inline');f.beforeSource(async()=>{if(change==='new-creator')f.host.creatorOpenGeneration++;else if(change==='unload')f.unload();else f.document.defaultView.closed=true;});
 await f.open(f.created);assert.deepEqual(f.calls,[]);assert.deepEqual(f.notices,[]);
});
test('Inline background source stays inactive when a newer Creator owns focus',async()=>{
 const f=fixture('background-tab','inline');f.beforeSource(async()=>{f.host.creatorOpenGeneration++;});await f.open(f.created);
 assert.equal(f.calls.some(c=>c[0]==='activate'),false);assert.equal(f.calls.find(c=>c[0]==='load')[2].eState.focus,false);
});
test('Inline source read failure leaves the committed task intact',async()=>{
 const f=fixture('source','inline');f.beforeSource(async()=>{throw Error('read failure');});await f.open(f.created);
 assert.deepEqual(f.calls,[]);assert.deepEqual(f.notices,['createdInlineTaskOpenFailed']);assert.equal(f.created.operonId,'task001');
});
for(const key of ['fileTaskAfterCreate','inlineTaskAfterCreate'] as const) test(`${key} exposes six ordered choices with separate source-tab labels`,()=>{
 const Tab=extract(['getSettingsSearchDropdownOptions'],{t:(_namespace:string,key:string)=>key,isTaskCardSetting:()=>false},'src/ui/settings-tab.ts','OperonSettingsTab');
 const tab:any=new Tab();tab.settings={...DEFAULT_SETTINGS};tab.isCalendarSidebarDefaultStateSettingKey=()=>false;
 const options=tab.getSettingsSearchDropdownOptions(key);assert.deepEqual(Object.keys(options),['none','source','source-and-editor','editor','new-tab','background-tab']);
 assert.equal(options.editor,'taskAfterCreateEditor');assert.equal(options['new-tab'],key==='fileTaskAfterCreate'?'fileTaskAfterCreateFocusedTab':'inlineTaskAfterCreateFocusedTab');
 assert.equal(DEFAULT_SETTINGS[key],'none');assert.equal(OPERON_SETTINGS_SEARCH_REGISTRY.filter(e=>e.key===key).length,1);
});

test('File and Inline after-create choices persist independently and reset only their own field',async()=>{
 const disk=new SettingsPreservationHarness({table:false});try{
  const storage=disk.createStorage();await storage.initialize();
  await storage.updateSettings({fileTaskAfterCreate:'source',inlineTaskAfterCreate:'editor'});
  await storage.updateSettings({inlineTaskAfterCreate:'background-tab'});
  assert.equal(storage.getSettings().fileTaskAfterCreate,'source');
  const loaded=disk.createStorage();await loaded.initialize();assert.equal(loaded.getSettings().fileTaskAfterCreate,'source');assert.equal(loaded.getSettings().inlineTaskAfterCreate,'background-tab');
  await loaded.updateSettings({fileTaskAfterCreate:'none'});assert.equal(disk.package().ui.taskCreationProfile.fileTaskAfterCreate,undefined);assert.equal(disk.package().ui.taskCreationProfile.inlineTaskAfterCreate,'background-tab');
 }finally{await disk.dispose();}
});
