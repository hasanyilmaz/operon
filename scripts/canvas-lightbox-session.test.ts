import assert from 'node:assert/strict';
import { test as nodeTest } from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import { getCanvasWorkspaceLeaves } from '../src/ui/native-lightbox-lifecycle';
const ts:typeof import('typescript')=createRequire(`${process.cwd()}/package.json`)('typescript');
interface CanvasTestContext { after(action:()=>void):void; mock:{timers:{enable(options:{apis:string[]}):void;tick(ms:number):void}} }
const test=(name:string,run:(context:CanvasTestContext)=>void|Promise<void>)=>nodeTest(name,context=>run(context as unknown as CanvasTestContext));
import { Platform, Scope } from 'obsidian';
import { bindLightboxContent, openLightbox, setLightboxCanvasScope } from '../src/ui/lightbox';
import { CanvasGroupSync, CanvasGroupSyncCoordinator } from '../src/ui/canvas-group-sync';
import { CanvasLightboxSessions } from '../src/ui/canvas-lightbox-session';
import { NativeLightboxLifecycle } from '../src/ui/native-lightbox-lifecycle';
import { canvasOwnsLightboxEscape } from '../src/ui/native-lightbox-surface';
import { isTaskCardCanvasReadOnly } from '../src/ui/task-card-canvas';
import { lightboxFixture } from './test-support/lightbox-dom';

const key=(value:unknown):string=>JSON.stringify(value,(_k,v)=>v && typeof v==='object' && !Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const scene=(text='initial')=>({nodes:[{id:'n',type:'text',text,x:0,y:0,width:100,height:100}],edges:[]});
const tick=()=>new Promise<void>(r=>setImmediate(r));
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};}
function fixture(quietMs=0,normalize=false) {
 const dom=lightboxFixture(),file:any={path:'A.canvas'}, files=new Map([[file.path,JSON.stringify(scene())]]),normal:any[]=[],all:any[]=[];
 let writes=0,imports=0,fail=false,uncertain=false,pause:ReturnType<typeof deferred>|null=null,readPause:ReturnType<typeof deferred>|null=null;
 const objects=new Map<string,any>([[file.path,file]]);
 const app:any={workspace:{getLeavesOfType:(type:string)=>type==='canvas'?normal:[]},vault:{getAbstractFileByPath:(path:string)=>files.has(path)?(objects.get(path) ?? file):null,read:async(f:any)=>{const value=files.get(f.path);if(readPause){const gate=readPause;readPause=null;await gate.promise;}return value;}}};
 class View {
  file=file;contentEl:any=dom.doc.body.createDiv();containerEl=this.contentEl;lastSavedData=files.get(file.path)!;data:string|null=this.lastSavedData;dirty=false;saving=false;saveAgain=false;
  state=scene();viewport={x:55,y:89,zoom:1.5};selection=new Set(['n']);closed=false;nativeTimer:ReturnType<typeof setTimeout>|null=null;
  canvas:any={getData:()=>this.state,nodes:new Map([['n',{isEditing:false,nodeEl:dom.doc.body.createDiv()}]]),data:this.state,readonly:false,isDragging:false,selection:this.selection};
  requestSave:()=>void;
  constructor(){if(normalize)Object.assign(this.state,{metadata:{version:'1.0-1.0'}});const captured=View.prototype.save.bind(this);this.requestSave=()=>{this.dirty=true;if(!this.nativeTimer)this.nativeTimer=setTimeout(()=>{this.nativeTimer=null;void captured().catch(()=>{});},2000);};}
  getViewType(){return 'canvas';}
  getViewData(){return JSON.stringify(this.canvas.data,null,'\t');}
  setData(text:string,_clear:boolean){imports++;this.data=text;this.state=JSON.parse(text);if(normalize)Object.assign(this.state,{metadata:{version:'1.0-1.0'}});this.canvas.data=this.state;}
  async loadFileInternal(f:any,clear:boolean){const text=await app.vault.read(f);this.lastSavedData=text;if(text!==this.data||clear)this.setData(text,clear);}
  clear(){this.closed=true;}
  async onUnloadFile(f:any){await this.save(true);if(this.file===f)this.file=null as any;}
  async onClose(){await this.onUnloadFile(this.file);}
  async save(clear=false){
   this.dirty=false;const f=this.file;if(!f)return;
   if(this.saving){if(!clear)this.saveAgain=true;return;}
   this.saveAgain=false;const text=this.getViewData();if(text===this.lastSavedData)return;
   const previous=this.lastSavedData;this.lastSavedData=text;this.data=text;this.saving=true;
   try{if(pause)await pause.promise;if(fail)throw Error('write');files.set(f.path,text);writes++;if(uncertain)throw Error('lost acknowledgement');for(const leaf of all)if(leaf.view!==this && leaf.view.file===f && !leaf.view.saving)void leaf.view.loadFileInternal(f,false);if(clear)this.clear();}
   catch(e){this.lastSavedData=previous;throw e;}finally{this.saving=false;if(this.saveAgain)void this.save();}
  }
 }
 const lifetimes:NativeLightboxLifecycle[]=[];
 function add(owned=false){const view=new View();const leaf:any={view,detach(){void view.onClose();leaf.detached=true;},async setViewState(state:any){if(state.state?.file && state.state.file!==file.path){await view.onUnloadFile(view.file);view.file=objects.get(state.state.file);await view.loadFileInternal(view.file,true);}},getViewState:()=>({type:'canvas',state:{file:view.file?.path}})};all.push(leaf);if(owned)lifetimes.push(new NativeLightboxLifecycle(app,leaf));else normal.push(leaf);return leaf;}
 let tail=Promise.resolve();const sessions=new CanvasLightboxSessions(app,{key,native:v=>(...args)=>Reflect.apply(View.prototype.save,v,args),write:async(_v,action)=>{const prev=tail;let release!:()=>void;tail=new Promise<void>(r=>{release=r;});await prev;try{await action();}finally{release();}}},quietMs);
 function edit(leaf:any,text:string,request=false){leaf.view.state=scene(text);leaf.view.canvas.data=leaf.view.state;leaf.view.dirty=true;if(request)leaf.view.requestSave();}
 return {...dom,app,file,files,normal,all,sessions,add,edit,addFile(path:string,text:string){const obj={path};objects.set(path,obj);files.set(path,JSON.stringify(scene(text)));return obj;},stats:()=>({writes,imports}),pause(){pause=deferred();return pause;},pauseRead(){readPause=deferred();return readPause;},fail(value=true){fail=value;},uncertain(value=true){uncertain=value;},async ready(leaf:any){assert.equal(await sessions.ready(leaf,()=>true),true);},dispose(){sessions.dispose();for(const x of lifetimes)x.dispose();for(const l of all)if(l.view.nativeTimer)clearTimeout(l.view.nativeTimer);},removeOwner(){for(const l of lifetimes)l.dispose();sessions.reconcile();}};
}

test('Canvas successful saves update clean peers in both directions and preserve viewport/selection',async t=>{
 const f=fixture();t.after(()=>f.dispose());const tab=f.add(),box=f.add(true);await f.ready(box);
 f.edit(box,'from box');await box.view.save();await tick();assert.equal(tab.view.state.nodes[0].text,'from box');
 f.edit(tab,'from tab');await tab.view.save();await tick();assert.equal(box.view.state.nodes[0].text,'from tab');
 assert.equal(f.stats().writes,2);assert.deepEqual(tab.view.viewport,{x:55,y:89,zoom:1.5});assert.deepEqual([...box.view.selection],['n']);
});
test('Canvas two divergent dirty buffers block writes, close and navigation without changing either',async t=>{
 const f=fixture();t.after(()=>f.dispose());const tab=f.add(),box=f.add(true);await f.ready(box);f.edit(tab,'tab edit');f.edit(box,'box edit');
 await assert.rejects(tab.view.save());await assert.rejects(box.view.save());assert.equal(await f.sessions.prepare(box),false);tab.detach();await tick();
 await tab.setViewState({state:{file:'B.canvas'}});assert.equal(tab.detached,undefined);assert.equal(tab.view.file,f.file);assert.equal(f.stats().writes,0);assert.equal(tab.view.state.nodes[0].text,'tab edit');assert.equal(box.view.state.nodes[0].text,'box edit');
});
test('Canvas Undo resolves divergence and queued native cadence resumes the remaining dirty peer',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});const f=fixture();t.after(()=>f.dispose());const tab=f.add(),box=f.add(true);await f.ready(box);
 f.edit(tab,'tab edit',true);f.edit(box,'box edit',true);t.mock.timers.tick(2000);await tick();assert.equal(f.stats().writes,0);
 f.edit(box,'initial',true);t.mock.timers.tick(1999);await tick();assert.equal(f.stats().writes,0);t.mock.timers.tick(1);await tick();await tick();assert.equal(f.stats().writes,1);assert.equal(box.view.state.nodes[0].text,'tab edit');
});
test('Canvas same dirty scene is safe across three views and needs one native write',async t=>{
 const f=fixture();t.after(()=>f.dispose());const a=f.add(),b=f.add(),box=f.add(true);await f.ready(box);f.edit(a,'same');f.edit(b,'same');f.edit(box,'same');await a.view.save();await b.view.save();await box.view.save();assert.equal(f.stats().writes,1);
});
test('Canvas edits made during delayed save stay dirty and are not cleared by close-save',async t=>{
 const f=fixture();t.after(()=>f.dispose());f.add();const box=f.add(true);await f.ready(box);f.edit(box,'first');const gate=f.pause(),saving=box.view.save(true);await tick();f.edit(box,'second');gate.resolve();await saving;
 assert.equal(box.view.closed,false);assert.equal(box.view.state.nodes[0].text,'second');assert.equal(JSON.parse(f.files.get(f.file.path)!).nodes[0].text,'first');assert.equal(await f.sessions.prepare(box),true);assert.equal(f.stats().writes,2);
});
test('Canvas interaction defers clean-peer refresh until the gesture finishes',async t=>{
 const f=fixture();t.after(()=>f.dispose());const tab=f.add(),box=f.add(true);await f.ready(box);tab.view.canvas.isDragging=true;f.edit(box,'updated');await box.view.save();assert.equal(tab.view.state.nodes[0].text,'initial');tab.view.canvas.isDragging=false;tab.view.contentEl.events.get('pointerup')?.({});await tick();assert.equal(tab.view.state.nodes[0].text,'updated');
});
test('Canvas edit arriving during asynchronous native refresh is preserved',async t=>{
 const f=fixture();t.after(()=>f.dispose());const tab=f.add(),box=f.add(true);await f.ready(box);const gate=f.pauseRead();const loading=tab.view.loadFileInternal(f.file,false);f.edit(tab,'new edit');gate.resolve();await loading;assert.equal(tab.view.state.nodes[0].text,'new edit');assert.equal(JSON.parse(tab.view.lastSavedData).nodes[0].text,'initial');
});
test('Canvas failed native save is retained and close or timer does not retry it',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});const f=fixture();t.after(()=>f.dispose());const box=f.add(true);await f.ready(box);f.edit(box,'failed',true);f.fail();await assert.rejects(box.view.save());f.fail(false);assert.equal(await f.sessions.prepare(box),false);box.view.requestSave();t.mock.timers.tick(5000);await tick();assert.equal(f.stats().writes,0);assert.equal(box.view.state.nodes[0].text,'failed');assert.equal(box.view.closed,false);
});
test('Canvas ambiguous write can be verified without replaying it',async t=>{
 const f=fixture();t.after(()=>f.dispose());const box=f.add(true);await f.ready(box);f.edit(box,'saved');f.uncertain();await assert.rejects(box.view.save());assert.equal(await f.sessions.prepare(box),true);assert.equal(f.stats().writes,1);assert.equal(box.view.closed,false);
});
test('Canvas admission waits for old bound native callback and remains cancellable',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});const f=fixture(2000);t.after(()=>f.dispose());const tab=f.add(),box=f.add(true);f.edit(tab,'pending',true);let allowed=true,settled=false;const admission=f.sessions.ready(box,()=>allowed).then(ok=>{settled=true;return ok;});
 assert.equal(tab.view.contentEl.inert,undefined); // Existing tabs stay interactive throughout initial admission.
 allowed=false;t.mock.timers.tick(25);await tick();assert.equal(await admission,false);assert.equal(settled,true);assert.equal(f.sessions.has(box.view),false);assert.equal(tab.view.contentEl.inert,undefined);t.mock.timers.tick(2000);await tick();assert.equal(f.stats().writes,1);
});
test('Canvas later normal peer is admitted before protected writes resume',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});const f=fixture();t.after(()=>f.dispose());const box=f.add(true);await f.ready(box);const tab=f.add();f.sessions.reconcile();await tick();assert.equal(f.sessions.has(tab.view),true);f.edit(tab,'tab');f.edit(box,'box');assert.equal(f.sessions.canSave(box.view),false);await assert.rejects(tab.view.save());assert.equal(f.stats().writes,0);
});
test('Canvas concurrent same-file admissions install guards for every view',async t=>{
 const f=fixture();t.after(()=>f.dispose());const first=f.add(true),pending=f.sessions.ready(first,()=>true),second=f.add(true);const results=await Promise.all([pending,f.sessions.ready(second,()=>true)]);assert.deepEqual(results,[true,true]);assert.equal(f.sessions.has(first.view),true);assert.equal(f.sessions.has(second.view),true);
});
test('Canvas rename rebinds file identity without writing through an obsolete path',async t=>{
 const f=fixture();t.after(()=>f.dispose());const tab=f.add(),box=f.add(true);await f.ready(box);f.files.set('Renamed.canvas',f.files.get(f.file.path)!);f.files.delete(f.file.path);f.file.path='Renamed.canvas';f.sessions.reconcile();await tick();assert.equal(f.sessions.canSave(box.view),true);f.edit(tab,'after rename');await tab.view.save();assert.equal(f.files.has('A.canvas'),false);assert.equal(await f.sessions.prepare(box),true);
});
test('Canvas deletion blocks stale native callbacks and retains dirty content',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});const f=fixture();t.after(()=>f.dispose());const box=f.add(true);await f.ready(box);f.edit(box,'keep',true);f.files.delete(f.file.path);t.mock.timers.tick(2000);await tick();assert.equal(f.stats().writes,0);assert.equal(box.view.state.nodes[0].text,'keep');assert.equal(await f.sessions.prepare(box),false);
});
test('Canvas native unload stays guarded until it completes and does not rewrite formatting',async t=>{
 const f=fixture();t.after(()=>f.dispose());const tab=f.add(),box=f.add(true);await f.ready(box);const closing=box.view.onClose();f.removeOwner();await closing;assert.equal(f.stats().writes,0);assert.equal(f.sessions.has(box.view),false);assert.equal(tab.view.closed,false);
});
test('Canvas outer plugin wrappers keep working after the last lightbox session is released',async t=>{
 const f=fixture();t.after(()=>f.dispose());const tab=f.add(),box=f.add(true);await f.ready(box);const inner=tab.view.save;let calls=0;tab.view.save=async()=>{calls++;await inner.call(tab.view);};f.removeOwner();f.edit(tab,'ordinary');await tab.view.save();assert.equal(calls,1);assert.equal(f.stats().writes,1);
});
test('Canvas dirty peer retains its guarded timer after the last lightbox closes',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});const f=fixture();t.after(()=>f.dispose());const tab=f.add(),box=f.add(true);await f.ready(box);f.edit(tab,'pending',true);await box.view.onClose();f.removeOwner();t.mock.timers.tick(2000);await tick();assert.equal(f.stats().writes,1);assert.equal(JSON.parse(f.files.get(f.file.path)!).nodes[0].text,'pending');
});
test('Canvas Esc intent is consumed by native selection, editing and drag before container close',()=>{
 const canvas:any={selection:new Set(['a']),nodes:new Map(),isDragging:false},view={getViewType:()=> 'canvas',canvas},event={} as KeyboardEvent;
 assert.equal(canvasOwnsLightboxEscape(view,event),true);canvas.selection.clear();assert.equal(canvasOwnsLightboxEscape(view,event),false);canvas.nodes.set('n',{isEditing:true});assert.equal(canvasOwnsLightboxEscape(view,event),true);canvas.nodes.clear();canvas.isDragging=true;assert.equal(canvasOwnsLightboxEscape(view,event),true);
});
test('Canvas owned task-card editing honors native read-only state',t=>{
 const f=fixture();t.after(()=>f.dispose());const box=f.add(true),node=box.view.canvas.nodes.get('n').nodeEl,root:any={closest:()=>node};assert.equal(isTaskCardCanvasReadOnly(f.app,root),false);box.view.canvas.readonly=true;assert.equal(isTaskCardCanvasReadOnly(f.app,root),true);
});

test('Canvas native constructor-bound save drains before the guarded callback is installed',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});const f=fixture(2000);t.after(()=>f.dispose());const tab=f.add(),box=f.add(true);f.edit(tab,'before admission',true);let settled=false;
 const ready=f.sessions.ready(box,()=>true).then(ok=>{settled=true;return ok;});t.mock.timers.tick(1999);await tick();assert.equal(settled,false);assert.equal(tab.view.contentEl.inert,undefined);
 t.mock.timers.tick(1);await tick();t.mock.timers.tick(25);await tick();assert.equal(await ready,true);assert.equal(f.stats().writes,1);
 f.edit(tab,'tab conflict',true);f.edit(box,'box conflict',true);t.mock.timers.tick(4000);await tick();assert.equal(f.stats().writes,1);assert.equal(f.sessions.canSave(box.view),false);
});
test('Canvas navigation retires old guards through native unload and can admit the new file',async t=>{
 const f=fixture();t.after(()=>f.dispose());const box=f.add(true);await f.ready(box);f.edit(box,'old file edit');const other=f.addFile('B.canvas','other file');await box.setViewState({state:{file:'B.canvas'}});assert.equal(box.view.file,other);assert.equal(box.view.state.nodes[0].text,'other file');assert.equal(f.sessions.has(box.view),false);await f.ready(box);f.edit(box,'new file edit');await box.view.save();assert.equal(JSON.parse(f.files.get('A.canvas')!).nodes[0].text,'old file edit');assert.equal(JSON.parse(f.files.get('B.canvas')!).nodes[0].text,'new file edit');
});
test('Canvas external disk change blocks a stale buffer write before native save',async t=>{
 const f=fixture();t.after(()=>f.dispose());const box=f.add(true);await f.ready(box);f.edit(box,'mine');f.files.set(f.file.path,JSON.stringify(scene('external')));await assert.rejects(box.view.save());assert.equal(f.stats().writes,0);assert.equal(box.view.state.nodes[0].text,'mine');assert.equal(JSON.parse(f.files.get(f.file.path)!).nodes[0].text,'external');
});
test('Canvas failed write can return clean by Undo without another native attempt',async t=>{
 const f=fixture();t.after(()=>f.dispose());const box=f.add(true);await f.ready(box);f.edit(box,'failed');f.fail();await assert.rejects(box.view.save());f.edit(box,'initial');assert.equal(await f.sessions.prepare(box),true);assert.equal(f.stats().writes,0);
});
test('Canvas container scope retains native commands and restores the previous stack on close',()=>{
 const f=lightboxFixture(),base=new Scope(),workspaceScope=new Scope(base),stack:Scope[]=[];f.doc.defaultView.app={scope:base,workspace:{scope:workspaceScope},keymap:{pushScope:(scope:Scope)=>stack.push(scope),popScope:(scope:Scope)=>{assert.equal(stack.pop(),scope);}}};
 const close=openLightbox(f.anchor,{title:'Canvas',render:shell=>{setLightboxCanvasScope(shell,true);return bindLightboxContent(shell,{content:shell.createDiv()});}});assert.equal(stack.length,1);assert.equal(Reflect.get(stack[0],'parent'),workspaceScope);close();assert.equal(stack.length,0);
});
test('Canvas native Escape intent survives deselection before the document bubble listener',()=>{
 const f=lightboxFixture(),base=new Scope(),stack:Scope[]=[];f.doc.defaultView.app={scope:base,workspace:{scope:base},keymap:{pushScope:(s:Scope)=>stack.push(s),popScope:()=>stack.pop()}};let selected=true,shell:any;
 const close=openLightbox(f.anchor,{title:'Canvas',render:root=>{shell=root;return bindLightboxContent(root,{content:root.createDiv(),ownsEscape:()=>selected});}});
 const event:any={key:'Escape',target:shell,preventDefault(){},stopPropagation(){}};(Reflect.get(stack[0],'handlers') as Array<{key:string;callback:(event:KeyboardEvent)=>unknown}>).find(h=>h.key==='Escape')!.callback(event);selected=false;f.emit('keydown',event);assert.equal(shell.isConnected,true);f.emit('keydown',{...event});assert.equal(shell.isConnected,false);close();
});
test('Canvas pending container leaves focus and Escape in the existing tab',()=>{
 const f=lightboxFixture(),desktop=Platform.isDesktopApp;Platform.isDesktopApp=true;let shell:any;const close=openLightbox(f.anchor,{title:'Canvas',render:root=>{shell=root;return bindLightboxContent(root,{content:root.createDiv(),backgroundInteractive:()=>true});}});
 try{f.anchor.focus();f.emit('focusin',{target:f.anchor});assert.equal(f.doc.activeElement,f.anchor);f.emit('keydown',{key:'Escape',target:f.anchor});assert.equal(shell.isConnected,true);}finally{close();Platform.isDesktopApp=desktop;}
});

test('Canvas manually matching a confirmed external snapshot resolves stale-baseline protection without a write',async t=>{
 const f=fixture();t.after(()=>f.dispose());const box=f.add(true);await f.ready(box);f.files.set(f.file.path,JSON.stringify(scene('external')));f.edit(box,'external');assert.equal(await f.sessions.prepare(box),true);assert.equal(f.stats().writes,0);
});

test('Canvas scope follows navigation from Markdown to Canvas and back',()=>{
 const f=lightboxFixture(),base=new Scope(),canvas=new Scope(base),stack:Scope[]=[];f.doc.defaultView.app={scope:base,workspace:{scope:canvas},keymap:{pushScope:(s:Scope)=>stack.push(s),popScope:()=>stack.pop()}};let shell:any;
 const close=openLightbox(f.anchor,{title:'Note',render:root=>{shell=root;return null;}});try{assert.equal(Reflect.get(stack[0],'parent'),base);setLightboxCanvasScope(shell,true);assert.equal(Reflect.get(stack[0],'parent'),canvas);setLightboxCanvasScope(shell,false);assert.equal(Reflect.get(stack[0],'parent'),base);}finally{close();}
});
test('Canvas late peer navigating to another Canvas during admission cannot deadlock the original group',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});const f=fixture(50);t.after(()=>f.dispose());const box=f.add(true),initial=f.sessions.ready(box,()=>true);t.mock.timers.tick(50);await tick();assert.equal(await initial,true);
 const tab=f.add();f.sessions.reconcile();assert.equal(tab.view.contentEl.inert,true);tab.view.file=f.addFile('B.canvas','other');t.mock.timers.tick(25);await tick();assert.equal(f.sessions.canSave(box.view),true);assert.equal(tab.view.contentEl.inert,undefined);assert.equal(await f.sessions.prepare(box),true);
});
test('Canvas verified ambiguous write updates the real coordinator before the next edit',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});const f=fixture();t.after(()=>f.dispose());const box=f.add(true),coordinator=new CanvasGroupSyncCoordinator(),sessions=coordinator.lightboxSessions(f.app);t.after(()=>sessions.dispose());
 const opening=sessions.ready(box,()=>true);t.mock.timers.tick(2000);await tick();assert.equal(await opening,true);
 const member=new CanvasGroupSync(box.view,{isCurrent:()=>true} as any,{} as any,coordinator);Reflect.set(member,'active',true);member.schedule=()=>{};coordinator.add(member);coordinator.acceptBaseline(member,box.view.lastSavedData);
 f.edit(box,'first');f.uncertain();await assert.rejects(box.view.save());assert.equal(await sessions.prepare(box),true);f.uncertain(false);f.edit(box,'second');await box.view.save();assert.equal(f.stats().writes,2);assert.equal(await sessions.prepare(box),true);
});

test('Canvas task conversion preflight sees unsaved owned buffers without triggering a save',t=>{
 const f=fixture();t.after(()=>f.dispose());f.add();const box=f.add(true);
 const source=ts.createSourceFile('main.ts',readFileSync('main.ts','utf8'),ts.ScriptTarget.Latest,true);let method='';
 function visit(node:import('typescript').Node):void {if(ts.isMethodDeclaration(node)&&node.name.getText(source)==='tasksConversionBuffersMatch')method=node.getText(source);else ts.forEachChild(node,visit);}visit(source);assert.ok(method);
 const code=ts.transpile(`class Probe {${method}}`,{target:ts.ScriptTarget.ES2020});const Probe=new Function('getCanvasWorkspaceLeaves',`${code};return Probe;`)(getCanvasWorkspaceLeaves);
 const probe=new Probe();probe.app=f.app;probe.taskEditorDeleteOpenViewsMatch=()=>true;const raw=f.files.get(f.file.path)!;
 assert.equal(probe.tasksConversionBuffersMatch(f.file.path,raw),true);f.edit(box,'unsaved reference');assert.equal(probe.tasksConversionBuffersMatch(f.file.path,raw),false);box.view.saving=true;assert.equal(probe.tasksConversionBuffersMatch(f.file.path,raw),false);assert.equal(f.stats().writes,0);
});

test('Canvas cancelling pending admission cannot rewrite a newer peer save with stale formatted JSON',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});const f=fixture(2000);t.after(()=>f.dispose());const tab=f.add(),box=f.add(true);let allowed=true;
 const pending=f.sessions.ready(box,()=>allowed);f.files.set(f.file.path,JSON.stringify(scene('newer peer write')));allowed=false;t.mock.timers.tick(25);await tick();assert.equal(await pending,false);
 await box.view.onClose();assert.equal(f.stats().writes,0);assert.equal(JSON.parse(f.files.get(f.file.path)!).nodes[0].text,'newer peer write');assert.equal(tab.view.contentEl.inert,undefined);
});

test('Canvas failed admission protects pending owned close before inspecting unsupported peer save wrappers',async t=>{
 const f=fixture();t.after(()=>f.dispose());const tab=f.add(),box=f.add(true);tab.view.save=async()=>{};f.files.set(f.file.path,JSON.stringify(scene('newer peer write')));
 const sessions=new CanvasGroupSyncCoordinator().lightboxSessions(f.app);t.after(()=>sessions.dispose());assert.equal(await sessions.ready(box,()=>true),false);await box.view.onClose();assert.equal(f.stats().writes,0);assert.equal(JSON.parse(f.files.get(f.file.path)!).nodes[0].text,'newer peer write');
});
test('Canvas duplicate clean native reload settles before native close without formatting writes',async t=>{
 const f=fixture();t.after(()=>f.dispose());const box=f.add(true);await f.ready(box);await box.view.loadFileInternal(f.file,false);assert.equal(await f.sessions.prepare(box),true);await box.view.onClose();assert.equal(f.stats().writes,0);
});

test('Canvas load normalization admits clean peers without persisting metadata or inventing a conflict',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});const f=fixture(0,true);t.after(()=>f.dispose());const tab=f.add(),box=f.add(true);let allowed=true;const opening=f.sessions.ready(box,()=>allowed);await tick();allowed=false;t.mock.timers.tick(25);await tick();assert.equal(await opening,true);
 t.mock.timers.tick(4000);await tick();assert.equal(f.stats().writes,0);assert.equal(await f.sessions.prepare(box),true);
 f.edit(tab,'real edit',true);t.mock.timers.tick(2000);await tick();await tick();assert.equal(f.stats().writes,1);assert.equal(box.view.state.nodes[0].text,'real edit');assert.equal(await f.sessions.prepare(box),true);
});
test('Canvas a real edit during asynchronous reload retains its native autosave request',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});const f=fixture();t.after(()=>f.dispose());const box=f.add(true);await f.ready(box);const read=f.pauseRead(),loading=box.view.loadFileInternal(f.file,false);f.edit(box,'typed during read',true);read.resolve();await loading;t.mock.timers.tick(2000);await tick();assert.equal(f.stats().writes,1);assert.equal(JSON.parse(f.files.get(f.file.path)!).nodes[0].text,'typed during read');
});
test('Canvas verifies the native queued snapshot when live geometry changes during a later drag',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});const f=fixture();t.after(()=>f.dispose());const box=f.add(true);await f.ready(box);f.edit(box,'queued text',true);
 box.view.state=structuredClone(box.view.state);box.view.state.nodes[0].x=200;box.view.canvas.isDragging=true;t.mock.timers.tick(2000);await tick();assert.equal(f.stats().writes,1);assert.equal(JSON.parse(f.files.get(f.file.path)!).nodes[0].x,0);
 box.view.canvas.isDragging=false;box.view.canvas.data=box.view.state;box.view.requestSave();t.mock.timers.tick(2000);await tick();assert.equal(f.stats().writes,2);assert.equal(JSON.parse(f.files.get(f.file.path)!).nodes[0].x,200);assert.equal(await f.sessions.prepare(box),true);
});

test('Canvas admission rechecks old callback quiet time after refreshing an initially stale owned view',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});const f=fixture(50);t.after(()=>f.dispose());const box=f.add(true);f.files.set(f.file.path,JSON.stringify(scene('disk new')));const tab=f.add();f.edit(tab,'disk new');tab.view.dirty=false;
 const gate=deferred(),original=f.app.vault.read;let reads=0;f.app.vault.read=async(file:any)=>{const text=await original(file);if(++reads===2)await gate.promise;return text;};let admitted=false;const opening=f.sessions.ready(box,()=>true).then(ok=>{admitted=ok;return ok;});
 t.mock.timers.tick(50);await tick();f.edit(tab,'edit during owned read',true);gate.resolve();await tick();assert.equal(admitted,false);
 t.mock.timers.tick(2000);await tick();t.mock.timers.tick(50);await tick();assert.equal(await opening,true);assert.equal(f.stats().writes,1);
 f.edit(tab,'tab conflict',true);f.edit(box,'box conflict',true);t.mock.timers.tick(2000);await tick();assert.equal(f.stats().writes,1);
});

test('Canvas unresolved ambiguous save remains unavailable for group operations after Undo',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});const f=fixture();t.after(()=>f.dispose());const box=f.add(true),coordinator=new CanvasGroupSyncCoordinator(),sessions=coordinator.lightboxSessions(f.app);t.after(()=>sessions.dispose());const opening=sessions.ready(box,()=>true);t.mock.timers.tick(2000);await tick();assert.equal(await opening,true);
 const member=new CanvasGroupSync(box.view,{isCurrent:()=>true} as any,{isBusy:false,reserve:()=>()=>{}} as any,coordinator);Reflect.set(member,'active',true);member.schedule=()=>{};coordinator.add(member);coordinator.acceptBaseline(member,box.view.lastSavedData);
 f.edit(box,'ambiguous');f.uncertain();await assert.rejects(box.view.save());f.edit(box,'initial');assert.equal(await sessions.prepare(box),false);assert.equal(sessions.clean(box.view),false);assert.equal(coordinator.acquire(member),null);
});
