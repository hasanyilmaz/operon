import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const ts: typeof import('typescript') = createRequire(`${process.cwd()}/package.json`)('typescript');
import { bindNativeLightboxMethod, NativeLightboxLifecycle, trackLightboxTableCallbacks, getNativeLightboxLeaves } from '../src/ui/native-lightbox-lifecycle';
import { TablePresetRegistry } from '../src/storage/table-preset-registry';
import { createDefaultTablePreset, cloneTablePreset } from '../src/types/table';
import { serializeOperonTableFile } from '../src/storage/table-file';
import { lightboxFixture } from './test-support/lightbox-dom';

test('native method binding retains the original method, receiver, arguments and result', () => {
 const result = { saved: true };
 const calls: { receiver: unknown; args: [string, boolean?] }[] = [];
 const owner = {
  invoke(this: unknown, ...args: [string, boolean?]) {
   calls.push({ receiver: this, args });
   return result;
  },
 };
 const bound = bindNativeLightboxMethod(owner, 'invoke');
 owner.invoke = () => { throw new Error('replacement must not be called'); };
 assert.equal(bound('first'), result);
 assert.equal(Reflect.apply(bound, { different: true }, ['second', false]), result);
 assert.equal(calls[0].receiver, owner);
 assert.equal(calls[1].receiver, owner);
 assert.deepEqual(calls.map(call => call.args), [['first'], ['second', false]]);
});

test('native method binding preserves Promise identity without awaiting or wrapping it', async () => {
 const result = Promise.resolve({ saved: true });
 const owner = { save() { return result; } };
 const bound = bindNativeLightboxMethod(owner, 'save');
 assert.equal(bound(), result);
 await result;
});

test('native method binding propagates the original synchronous error', () => {
 const failure = new Error('native save failed');
 const owner = { save(): never { throw failure; } };
 const bound = bindNativeLightboxMethod(owner, 'save');
 assert.throws(() => bound(), error => error === failure);
});

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred<T>() { let resolve!: (v:T)=>void; let reject!: (e:unknown)=>void; const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; }
function base() {
 const f=lightboxFixture();const files=new Map([['A.base','  original yaml'],['B.base','  untouched B']]);
 let text='normalized A',saves=0,clear=0,fail=false,pause:ReturnType<typeof deferred<void>>|null=null;
 const timers=new Map<number,()=>void>();let timer=0;
 f.doc.defaultView.setTimeout=(fn:()=>void)=>{timers.set(++timer,fn);return timer;};f.doc.defaultView.clearTimeout=(id:number)=>timers.delete(id);
 const events=new Set<()=>void>();const rows:any={undoStack:[],redoStack:[],async createTransaction(action:any){const changes:any[]=[];await action(changes);},async undoTransaction(){},async redoTransaction(){}};
 const view:any={file:{path:'A.base'},data:files.get('A.base'),lastSavedData:files.get('A.base'),saving:false,dirty:false,
  containerEl:f.doc.body.createDiv(),controller:{view:rows,events:{on:(_n:string,fn:()=>void)=>events.add(fn),off:(_n:string,fn:()=>void)=>events.delete(fn)}},
  getViewType:()=> 'bases',getViewData:()=>text,setViewData(value:string){text=value;},clear(){clear++;},
  async save(clear:boolean){saves++;view.dirty=false;view.saving=true;try{if(pause)await pause.promise;if(fail)throw Error('disk');files.set(view.file.path,text);view.data=text;view.lastSavedData=text;if(clear)view.clear();}finally{view.saving=false;}}
 };
 const app:any={vault:{read:async(file:any)=>files.get(file.path)}};const leaf:any={view};const owner=new NativeLightboxLifecycle(app,leaf);owner.attachCurrentView();
 return {...f,view,owner,rows,files,events,stats:()=>({saves,clear,timers:timers.size}),edit(value:string){text=value;view.requestSave();},fail(value=true){fail=value;},pause(){pause=deferred<void>();return pause;},fire(){for(const fn of [...timers.values()])fn();timers.clear();},dispose(){owner.dispose();}};
}
test('Base normalization, native unload and read-only close never write',async()=>{
 const f=base();try{assert.equal(await f.owner.prepare(),true);await f.view.save(true);assert.deepEqual(f.stats(),{saves:0,clear:1,timers:0});assert.equal(f.files.get('A.base'),'  original yaml');}finally{f.dispose();}
});
test('Base definition waits for native save; failed close retains data without retrying; explicit save recovers',async()=>{
 const f=base();try{
  f.edit('edited');f.fail();assert.equal(await f.owner.prepare(),false);assert.equal(f.stats().clear,0);assert.equal(f.stats().timers,0);
  f.fail(false);assert.equal(await f.owner.prepare(),false);assert.equal(f.stats().saves,1);
  const wait=f.pause();const save=f.view.save();let settled=false;const close=f.owner.prepare().then(ok=>{settled=true;return ok;});await tick();assert.equal(settled,false);
  wait.resolve();await save;assert.equal(await close,true);assert.equal(f.files.get('A.base'),'edited');
 }finally{f.dispose();}
});
test('Base queued A autosave cannot rewrite B after a native file transition',async()=>{
 const f=base();try{
  f.edit('edited A');assert.equal(await f.owner.prepare(),true);
  f.view.file={path:'B.base'};f.view.lastSavedData='  untouched B';f.view.data='  untouched B';f.view.setViewData('normalized B',true);
  f.fire();await tick();assert.equal(await f.owner.prepare(),true);await f.view.save(true);
  assert.equal(f.files.get('A.base'),'edited A');assert.equal(f.files.get('B.base'),'  untouched B');assert.equal(f.stats().saves,1);
 }finally{f.dispose();}
});
test('Base external source changes are never overwritten',async()=>{
 const f=base();try{f.edit('my edit');f.files.set('A.base','external');assert.equal(await f.owner.prepare(),false);assert.equal(f.stats().saves,0);assert.equal(f.files.get('A.base'),'external');assert.equal(f.view.getViewData(),'my edit');}finally{f.dispose();}
});
test('Base owned autosave tracks failures and a later explicit edit can recover',async()=>{
 const f=base();try{f.edit('first');f.fail();f.fire();await tick();assert.equal(await f.owner.prepare(),false);f.fail(false);f.edit('second');f.fire();await tick();assert.equal(await f.owner.prepare(),true);assert.equal(f.files.get('A.base'),'second');}finally{f.dispose();}
});
function change(file:string,field:string){return {file:{path:file},start:{[field]:'old'},end:{[field]:'new'}};}
test('Base unrelated row success never hides a failed native transaction, including overlap',async()=>{
 const f=base();try{
  const a=deferred<void>();const failed=f.rows.createTransaction(async(changes:any[])=>{changes.push(change('A.md','x'));await a.promise;});
  await f.rows.createTransaction(async(changes:any[])=>{changes.push(change('B.md','y'));});a.reject(Error('disk'));await assert.rejects(failed);assert.equal(await f.owner.prepare(),false);
  await f.rows.createTransaction(async(changes:any[])=>{changes.push(change('B.md','y'));});assert.equal(await f.owner.prepare(),false);
  await f.rows.createTransaction(async(changes:any[])=>{changes.push(change('A.md','x'));});assert.equal(await f.owner.prepare(),true);
 }finally{f.dispose();}
});
test('Base active view changes attach transaction guards and undo/redo stay native',async()=>{
 const f=base();try{let calls=0;const surface:any={undoStack:[{changes:[change('A.md','x')]}],redoStack:[{changes:[change('A.md','x')]}],async undoTransaction(){calls++;},async redoTransaction(){calls++;}};f.view.controller.view=surface;for(const event of f.events)event();await surface.undoTransaction();await surface.redoTransaction();assert.equal(calls,2);assert.equal(await f.owner.prepare(),true);}finally{f.dispose();assert.equal(f.events.size,0);}
});
function table(){const leaf:any={view:{getViewType:()=> 'operon-table-file-view'}};const owner=new NativeLightboxLifecycle({} as any,leaf);return {leaf,owner};}
test('Table missing/conflict results retain failure by property; unrelated edits cannot clear it',async()=>{
 const f=table();try{let result:any='missing';const callbacks=trackLightboxTableCallbacks(f.leaf,{onUpdateFileProperty:async()=>result});
  await callbacks.onUpdateFileProperty!('task',{propertyName:'A'} as any);assert.equal(await f.owner.prepare(),false);
  result='updated';await callbacks.onUpdateFileProperty!('task',{propertyName:'B'} as any);assert.equal(await f.owner.prepare(),false);
  await callbacks.onUpdateFileProperty!('task',{propertyName:'A'} as any);assert.equal(await f.owner.prepare(),true);
 }finally{f.owner.dispose();}
});
test('Table close awaits submitted task saves and preserves callback result',async()=>{
 const f=table();try{const write=deferred<boolean>();let calls=0;const callbacks=trackLightboxTableCallbacks(f.leaf,{onUpdateTaskFields:()=>{calls++;return write.promise;}});assert.equal(callbacks.onUpdateTaskFields!('task',{custom:'new'}),write.promise);
  let done=false;const close=f.owner.prepare().then(ok=>{done=true;return ok;});await tick();assert.equal(done,false);write.resolve(true);assert.equal(await close,true);assert.equal(calls,1);
 }finally{f.owner.dispose();}
});
test('Table separate fields, sessions and windows retain independent failure state',async()=>{
 const a=table(),b=table();try{let result=false;const callbacks=trackLightboxTableCallbacks(a.leaf,{onUpdateTaskFields:async()=>result,onEditTaskSession:async()=>result});
  await callbacks.onUpdateTaskFields!('task',{a:'x'});result=true;await callbacks.onUpdateTaskFields!('task',{b:'x'});assert.equal(await a.owner.prepare(),false);assert.equal(await b.owner.prepare(),true);
  await callbacks.onUpdateTaskFields!('task',{a:'corrected'});result=false;await callbacks.onEditTaskSession!({operonId:'task',sessionIndex:1,start:'a',end:'b'} as any,'a','b');result=true;await callbacks.onEditTaskSession!({operonId:'task',sessionIndex:2,start:'c',end:'d'} as any,'c','d');assert.equal(await a.owner.prepare(),false);
 }finally{a.owner.dispose();b.owner.dispose();}
});
test('ordinary Table tabs retain the original callbacks object',()=>{const callbacks={onUpdateTaskFields:async()=>true};assert.equal(trackLightboxTableCallbacks({} as any,callbacks),callbacks);});
test('Table actual registry queue waits before teardown; failures are retained without forced retry',async()=>{
 const f=table();let fail=false,writes=0,scheduled:(()=>void)|null=null;const preset=createDefaultTablePreset();let source=serializeOperonTableFile(preset);
 const registry=new TablePresetRegistry({loadFileBindings:async()=>[{id:preset.id,path:'Test.table'}],listTableFiles:async()=>[{path:'Test.table'}],readTableFile:async()=>source,writeTableFile:async(_path,content)=>{writes++;if(fail)throw Error('disk');source=content;},applyPatch:(current,patch)=>({...current,...patch}),schedulePatch:fn=>{scheduled=fn;return 1;},cancelScheduledPatch:()=>{}});
 try{await registry.refresh();const callbacks=trackLightboxTableCallbacks(f.leaf,{onSavePresetPatch:patch=>registry.queuePatch(preset.id,'columns',patch)});
  const ticket=callbacks.onSavePresetPatch!({id:preset.id,name:'Changed'},{surfaceToken:'lightbox'});let closed=false;const close=f.owner.prepare().then(ok=>{closed=ok;});await tick();assert.equal(closed,false);scheduled!();await ticket.settled;await close;assert.equal(closed,true);assert.equal(writes,1);
  fail=true;const failed=callbacks.onSavePresetPatch!({id:preset.id,name:'Failed'},{surfaceToken:'lightbox'});scheduled!();await assert.rejects(failed.settled);assert.equal(await f.owner.prepare(),false);assert.equal(writes,2);assert.equal(await f.owner.prepare(),false);assert.equal(writes,2);
 }finally{registry.dispose();f.owner.dispose();}
});

test('a newer synchronous rejection cannot be cleared by an older successful write',async()=>{
 const f=table();try{const old=deferred<void>();f.owner.track('field',()=>old.promise);assert.throws(()=>f.owner.track('field',()=>{throw Error('admission');}));old.resolve();assert.equal(await f.owner.prepare(),false);f.owner.track('field',()=>true);assert.equal(await f.owner.prepare(),true);}finally{f.owner.dispose();}
});
test('foreign thenables are awaited and rejected outcomes block close',async()=>{
 const f=table();try{const pending=deferred<boolean>();f.owner.track('field',()=>({then:pending.promise.then.bind(pending.promise)}));let closed=false;const close=f.owner.prepare().then(ok=>{closed=true;return ok;});await tick();assert.equal(closed,false);pending.resolve(false);assert.equal(await close,false);}finally{f.owner.dispose();}
});
test('Base property read failure before changes collection can recover through explicit retry',async()=>{
 const f=base();try{
  let fail=true;const surface:any={async createTransaction(action:any){const changes:any[]=[];await action(changes);},updateProperty(file:any,property:string){return this.createTransaction(async(changes:any[])=>{if(fail)throw Error('read');changes.push(change(file.path,property));});}};
  f.view.controller.view=surface;for(const event of f.events)event();
  await assert.rejects(surface.updateProperty({path:'A.md'},'x'));assert.equal(await f.owner.prepare(),false);
  fail=false;await surface.updateProperty({path:'A.md'},'x');assert.equal(await f.owner.prepare(),true);
 }finally{f.dispose();}
});

function sourceMethods(file: string, names: string[]): string {
 const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
 const found = new Map<string, string>();
 const visit = (node: import('typescript').Node): void => {
  if (ts.isMethodDeclaration(node) && names.includes(node.name.getText(ast))) found.set(node.name.getText(ast), node.getText(ast));
  ts.forEachChild(node, visit);
 };
 visit(ast);
 assert.equal(found.size, names.length);
 return ts.transpileModule(`class Harness { ${[...found.values()].join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}

test('isolated Table Gantt toggles use the real registry refresh and save chain, retaining failure guards', async () => {
 const preset = createDefaultTablePreset();preset.gantt.enabled=false;
 let source=serializeOperonTableFile(preset), writes=0, fail=false;
 const registry=new TablePresetRegistry({loadFileBindings:async()=>[{id:preset.id,path:'Test.table'}],listTableFiles:async()=>[{path:'Test.table'}],readTableFile:async()=>source,writeTableFile:async(_path,content)=>{writes++;if(fail)throw Error('disk');source=content;},schedulePatch:()=>1,cancelScheduledPatch:()=>{},applyPatch:(current,patch)=>({...current,...patch})});
 const Table = new Function('Platform','renderTableGanttToolbarToggle','resolveNextTableGanttEnabled','cloneTablePreset','cancelTableNativePropertyRequest',sourceMethods('src/ui/table/operon-table-view.ts',['renderTableGanttToggle','applyRegistryPreset'])+';return Harness;')(
  {isPhone:false},(options:any)=>{options.container.toggle=options;},(enabled:boolean)=>!enabled,cloneTablePreset,()=>{});
 const Refresh = new Function('getNativeLightboxLeaves','OperonTableView','OPERON_TABLE_VIEW_TYPE','OPERON_TABLE_FILE_VIEW_TYPE','getOperonTableFilePathKey','runAsyncAction','hasUnknownMethod','callUnknownMethod',sourceMethods('main.ts',['refreshTableLeaves'])+';return Harness;')(
  getNativeLightboxLeaves,Table,'operon-table-view','operon-table-file-view',(path:string)=>path,(_label:string,run:()=>unknown)=>run(),(o:any,k:string)=>typeof o[k]==='function',(o:any,k:string)=>o[k]());
 const app:any={workspace:{getLeavesOfType:()=>[]}},otherApp:any={};
 const refresh=new Refresh();refresh.app=app;refresh.tablePresetRegistry=registry;
 const view=new Table(),leaf:any={view};
 Object.assign(view,{fileMode:true,file:{path:'Test.table'},filePreset:cloneTablePreset(preset),state:{},lifecycleEpoch:0,fileLoadGeneration:0,surfaceToken:'isolated-gantt',toolbar:{},renders:0,
  getViewType:()=> 'operon-table-file-view',normalizeState:(state:any)=>state,syncTableSearchStateFromPreset:()=>{},closeSearchTransientUi:()=>{},closeActivePicker:()=>{},
  getCurrentEditingPreset(){return this.filePreset;},renderIfVisibleOrInvalidate(){this.renders++;this.renderTableGanttToggle(this.toolbar,this.filePreset);}});
 const owner=new NativeLightboxLifecycle(app,leaf);
 const otherLeaf:any={view:{getViewType:()=> 'bases'}};const otherOwner=new NativeLightboxLifecycle(otherApp,otherLeaf);
 view.callbacks=trackLightboxTableCallbacks(leaf,{onSavePresetPatch:patch=>registry.queuePatch(preset.id,'gantt',patch)});
 const unsubscribe=registry.subscribe(preset.id,entry=>refresh.refreshTableLeaves(preset.id,entry),false);
 try {
  await registry.refresh();view.renderIfVisibleOrInvalidate();
  assert.deepEqual(getNativeLightboxLeaves(app),[leaf]);assert.deepEqual(getNativeLightboxLeaves(otherApp),[otherLeaf]);
  assert.equal(view.toolbar.toggle.canChangePreset,true);assert.equal(view.toolbar.toggle.enabled,false);assert.equal(writes,0);
  await view.toolbar.toggle.onToggle();assert.equal(view.toolbar.toggle.enabled,true);assert.equal(view.filePreset.gantt.enabled,true);assert.equal(writes,1);
  await view.toolbar.toggle.onToggle();assert.equal(view.toolbar.toggle.enabled,false);assert.equal(writes,2);assert.equal(await owner.prepare(),true);
  const renders=view.renders;refresh.refreshTableLeaves('unrelated',registry.get(preset.id));assert.equal(view.renders,renders);
  // A native tab accidentally also exposed by the workspace is refreshed only once.
  app.workspace.getLeavesOfType=(type:string)=>type==='operon-table-file-view'?[leaf]:[];
  refresh.refreshTableLeaves(preset.id,registry.get(preset.id));assert.equal(view.renders,renders+1);
  fail=true;await assert.rejects(view.toolbar.toggle.onToggle());assert.equal(await owner.prepare(),false);assert.equal(writes,3);assert.equal(view.filePreset.gantt.enabled,false);
  assert.equal(await owner.prepare(),false);assert.equal(writes,3);
 } finally { unsubscribe();registry.dispose();owner.dispose();otherOwner.dispose(); }
 assert.deepEqual(getNativeLightboxLeaves(app),[]);assert.deepEqual(getNativeLightboxLeaves(otherApp),[]);
});
