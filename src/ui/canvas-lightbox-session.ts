import { Notice, debounce, type App, type TFile, type WorkspaceLeaf } from 'obsidian';
import type { TaskCanvasView } from './canvas-task-adapter';
import { getOwnerWindow } from '../core/dom-compat';
import { bindNativeLightboxMethod, getCanvasWorkspaceLeaves, getNativeLightboxLeaves, notifyNativeLightboxView } from './native-lightbox-lifecycle';
import { t } from '../core/i18n';

interface NativeCanvasView extends TaskCanvasView {
 dirty: boolean;
 data: string | null;
 save(clear?:boolean):Promise<void>;
 getViewData():string;
 requestSave(): void;
 loadFileInternal(file: TFile, clear: boolean): Promise<void>;
 setData(text: string, clear: boolean): void;
 clear(): void;
 onUnloadFile(file:TFile):Promise<void>;
 onClose():Promise<void>;
}
interface SavePort {
 key(value: unknown): string;
 idle?(view: TaskCanvasView): boolean;
 confirmed?(view:TaskCanvasView,raw:string):void;
 native(view: TaskCanvasView): (...args: unknown[]) => unknown;
 write(view: TaskCanvasView, action: () => Promise<void>): Promise<void>;
}
interface Member {
 leaf: WorkspaceLeaf; view: NativeCanvasView; file: TFile; path: string;
 // Disk identity guards writes; clean tracks the native loaded scene, including plugin normalization.
 baseline: string; clean: string; raw: string; ready: boolean; failed: boolean; incoming: boolean;
 closing: boolean; renaming: boolean; active: boolean; applying: number; generation: number; schedule: () => void; failure: string | null; pending: Set<Promise<unknown>>; restore: (() => void)[];
 cancelTimer: () => void; nativeSave: (...args: unknown[]) => unknown;
}
interface Group { file: TFile; members: Map<TaskCanvasView, Member>; owners: Set<WorkspaceLeaf>; opening: Promise<boolean> | null; warned: boolean }

/** Per-view admission/lifecycle adapter. All writes delegate to the existing coordinator and native save. */
export class CanvasLightboxSessions {
 private readonly groups = new Map<TFile, Group>();
 private readonly warming = new WeakMap<NativeCanvasView,()=>void>();
 private readonly admitted = new WeakSet<TaskCanvasView>();
 private active = true;
 constructor(private readonly app: App, private readonly port: SavePort, private readonly quietMs = 2000) {}

 clean(view:TaskCanvasView):boolean|undefined {
  const m=this.group(view)?.members.get(view);return m?.ready?this.valid(m)&&!this.group(view)?.opening&&!m.failed&&!m.incoming&&!this.dirty(m):undefined;
 }
 has(view: TaskCanvasView): boolean { return this.admitted.has(view); }
 private scene(view: TaskCanvasView): string { return this.port.key(view.canvas.getData()); }
 private valid(m: Member): boolean {
  return this.active && m.active && m.view.file === m.file && m.file.path === m.path
   && this.app.vault.getAbstractFileByPath(m.path) === m.file;
 }
 private idle(m: Member): boolean {
  return !Reflect.get(m.view.canvas, 'isDragging') && ![...m.view.canvas.nodes.values()].some(n => n.isEditing) && (this.port.idle?.(m.view) ?? true);
 }
 private dirty(m: Member): boolean { return this.scene(m.view) !== m.clean; }
 private group(view: TaskCanvasView): Group | undefined { return view.file ? this.groups.get(view.file) : undefined; }
 private conflict(g: Group): boolean {
  const dirty = [...g.members.values()].filter(m => this.valid(m) && this.dirty(m));
  return new Set(dirty.map(m => this.scene(m.view))).size > 1;
 }
 private warn(g: Group): void {
  if (!g.warned) { g.warned = true; new Notice(t('notifications', 'canvasLightboxConflict')); }
 }
 canSave(view: TaskCanvasView, verifyOwnFailure=false): boolean {
  const g = this.group(view); if (!g) return true;
  if (g.opening || [...g.members.values()].some(m => !m.ready || !this.valid(m) || m.failed && (!verifyOwnFailure || m.view!==view)) || this.conflict(g)) {
   if (this.conflict(g)) this.warn(g);
   return false;
  }
  g.warned = false; return true;
 }
 private wrap(owner: object, key: string, value: unknown, m: Member): void {
  const descriptor = Object.getOwnPropertyDescriptor(owner, key);
  Reflect.set(owner, key, value);
  m.restore.push(() => {
   if (Reflect.get(owner, key) !== value) return;
   if (descriptor) Object.defineProperty(owner, key, descriptor); else Reflect.deleteProperty(owner, key);
  });
 }
 private readView(leaf: WorkspaceLeaf): NativeCanvasView | null {
  const v = leaf.view as unknown as NativeCanvasView;
  return v.file && v.canvas && typeof v.save === 'function' && typeof v.requestSave === 'function'
   && typeof v.loadFileInternal === 'function' && typeof v.setData === 'function' && typeof v.clear === 'function'
   && typeof v.getViewData === 'function' && typeof v.onClose === 'function' && typeof v.onUnloadFile === 'function' && typeof v.lastSavedData === 'string' ? v : null;
 }
 /** Pending owned views are inert: native close/old timers must not serialize a
  * stale loaded scene merely because its JSON formatting differs from disk. */
 private protectPending(view:NativeCanvasView):void {
  if(this.warming.has(view))return;
  const read=bindNativeLightboxMethod(view,'getViewData'),close=bindNativeLightboxMethod(view,'onClose');
  const readDescriptor=Object.getOwnPropertyDescriptor(view,'getViewData'),closeDescriptor=Object.getOwnPropertyDescriptor(view,'onClose');
  let active=true;
  const restore=():void=>{
   if(!active)return;active=false;this.warming.delete(view);
   if(view.getViewData===safeRead){if(readDescriptor)Object.defineProperty(view,'getViewData',readDescriptor);else Reflect.deleteProperty(view,'getViewData');}
   if(view.onClose===safeClose){if(closeDescriptor)Object.defineProperty(view,'onClose',closeDescriptor);else Reflect.deleteProperty(view,'onClose');}
  };
  const safeRead=():string=>active?view.lastSavedData ?? '':read();
  const safeClose=async():Promise<void>=>{try{await close();}finally{restore();}};
  view.getViewData=safeRead;view.onClose=safeClose;this.warming.set(view,restore);
 }
 private observe(g: Group, leaf: WorkspaceLeaf, fence: boolean): { member: Member; quiet: () => boolean } | null {
  const view = this.readView(leaf); if (!view || !view.file) return null;
  let lastRequest = Date.now();
  const m: Member = {leaf,view,file:view.file,path:view.file.path,baseline:this.port.key(JSON.parse(view.lastSavedData!)),
   clean:this.port.key(JSON.parse(view.lastSavedData!)),raw:view.lastSavedData!,ready:false,failed:false,incoming:false,closing:false,renaming:false,active:true,applying:0,generation:0,schedule:()=>{},failure:null,pending:new Set(),restore:[],cancelTimer:()=>{},nativeSave:this.port.native(view)};
  g.members.set(view,m);
  if(getNativeLightboxLeaves(this.app).includes(leaf))this.protectPending(view);
  const request = bindNativeLightboxMethod(view,'requestSave');
  this.wrap(view,'requestSave',()=>{lastRequest=Date.now();request();},m);
  if (fence && !getNativeLightboxLeaves(this.app).includes(leaf)) {
   const inert=view.contentEl.inert;view.contentEl.inert=true;m.restore.push(()=>{view.contentEl.inert=inert;});
  }
  return {member:m,quiet:()=>Date.now()-lastRequest>=this.quietMs && !view.saving && this.valid(m)};
 }
 async ready(leaf: WorkspaceLeaf, allowed: () => boolean): Promise<boolean> {
  const pending=leaf.view as unknown as NativeCanvasView;
  if(getNativeLightboxLeaves(this.app).includes(leaf) && !this.has(pending) && typeof pending.getViewData==='function' && typeof pending.onClose==='function' && typeof pending.lastSavedData==='string')this.protectPending(pending);
  const view = this.readView(leaf); if (!view?.file) return false;
  let g = this.groups.get(view.file);
  if (!g) {g={file:view.file,members:new Map(),owners:new Set(),opening:null,warned:false};this.groups.set(view.file,g);}
  if (getNativeLightboxLeaves(this.app).includes(leaf)) g.owners.add(leaf);
  const group=g,retained=this.has(view);
  if (g.opening) {
   const result=await g.opening;
   if(!allowed() || !result) {
    // The view may have been admitted while this caller waited. Cancellation
    // must not remove that live owner's protection or retry a failed operation.
    if(!this.has(view))group.owners.delete(leaf);
    if(result || !group.owners.size)this.reconcile();
    return false;
   }
   return this.ready(leaf,allowed);
  }
  if (g.members.has(view) && this.admitted.has(view) && getCanvasWorkspaceLeaves(this.app).filter(l=>(l.view as unknown as TaskCanvasView).file===group.file).every(l=>group.members.has(l.view as unknown as TaskCanvasView))) return allowed();
  const run=async():Promise<boolean>=>{
   const observations: {member:Member;quiet:()=>boolean}[]=[];
   let admitted=false;
   const fence=[...group.members.values()].some(m=>m.ready);
   const loaded=new Map([...group.members.values()].filter(m=>m.ready).map(m=>[m.baseline,m.clean]));
   let stored='';
   try {
    if(!this.has(view))loaded.set(this.port.key(JSON.parse(view.lastSavedData!)),this.scene(view));
    while(this.active && allowed()) {
     let loading=false;
     const current=new Set(getCanvasWorkspaceLeaves(this.app));
     for(const peer of current) {
      const native=peer.view as unknown as NativeCanvasView;
      if(native.file!==group.file || group.members.has(native))continue;
      // Workspace events can expose a native view before its first file read.
      if(native.lastSavedData===null && native.canvas && typeof native.loadFileInternal==='function') {loading=true;continue;}
      const observation=this.observe(group,peer,fence);if(!observation)throw new Error('Canvas native lifecycle unavailable');
      observations.push(observation);
     }
     for(let i=observations.length-1;i>=0;i--) {
      const m=observations[i].member;
      if(!current.has(m.leaf) || (m.leaf.view as unknown)!==m.view || m.view.file!==m.file) {this.removeMember(group,m);observations.splice(i,1);if(m.leaf===leaf)return false;}
      else if(m.path!==m.file.path && this.app.vault.getAbstractFileByPath(m.file.path)===m.file)m.path=m.file.path;
     }
     if(!loading && observations.every(o=>o.quiet())) {
      stored=await this.app.vault.read(group.file);
      if(observations.every(o=>o.quiet()) && getCanvasWorkspaceLeaves(this.app).every(peer=>(peer.view as unknown as TaskCanvasView).file!==group.file || group.members.has(peer.view as unknown as TaskCanvasView))) {
       const disk=this.port.key(JSON.parse(stored));
       if(!this.has(view) && this.port.key(JSON.parse(view.lastSavedData!))!==disk) {
        view.dirty=false;await view.loadFileInternal(group.file,false);
        continue;
       }
       break;
      }
     }
     await new Promise<void>(resolve=>getOwnerWindow(view.contentEl).setTimeout(resolve,25));
    }
    if(!this.active || !allowed())return false;
    if(!allowed())return false;
    const key=this.port.key(JSON.parse(stored));
    if(!this.has(view)) {
     loaded.set(key,this.scene(view));
    }
    for(const {member:m} of observations) {
     if(!this.valid(m))return false;
     m.raw=m.view.lastSavedData!;m.baseline=this.port.key(JSON.parse(m.raw));
     m.clean=loaded.get(m.baseline)??m.baseline;m.incoming=m.baseline!==key;
     if(this.scene(m.view)===key){m.raw=stored;m.baseline=key;m.clean=key;m.incoming=false;}
     this.install(group,m);m.ready=true;this.admitted.add(m.view);
     if (!getNativeLightboxLeaves(this.app).includes(m.leaf)) m.view.contentEl.inert=false;
    }
    admitted=true;return true;
   } catch(error) {console.error('Operon: Canvas lightbox admission failed',error);new Notice(t('notifications','canvasTaskUnavailable'));return false;}
   finally {if(!admitted)for(const {member} of observations){member.ready=false;this.removeMember(group,member);}}
  };
  // run() may fail before its first await. Clear only the published promise,
  // after assignment, so a resolved failure cannot become a permanent barrier.
  const opening=group.opening=run();
  let result:boolean;
  try{result=await opening;}finally{if(group.opening===opening)group.opening=null;}
  if(!result) {if(!retained)group.owners.delete(leaf);if(!group.owners.size)this.release(group);}
  else {
   notifyNativeLightboxView(this.app);
   this.queue(group);
  }
  return result;
 }
 private install(g: Group,m: Member): void {
  const v=m.view;
  this.warming.get(v)?.();
  const close=bindNativeLightboxMethod(v,'onClose');
  this.wrap(v,'onClose',async()=>{
   if(!m.active){await close();return;}
   m.closing=true;
   try{if(!await this.prepare(m.leaf))throw new Error('Canvas close blocked');await close();if(m.active && !m.pending.size)this.removeMember(g,m);}finally{m.closing=false;this.reconcile();}
  },m);
  const unload=bindNativeLightboxMethod(v,'onUnloadFile');
  this.wrap(v,'onUnloadFile',async(file:TFile)=>{
   if(!m.active){await unload(file);return;}
   if(!await this.prepare(m.leaf))throw new Error('Canvas unload blocked');
   m.closing=true;
   try{await unload(file);this.removeMember(g,m);g.owners.delete(m.leaf);}
   finally{m.closing=false;this.reconcile();}
  },m);
  const load=bindNativeLightboxMethod(v,'loadFileInternal'), set=bindNativeLightboxMethod(v,'setData'), previousSave=bindNativeLightboxMethod(v,'save'), previousRequest=bindNativeLightboxMethod(v,'requestSave');
  const reload=async(file:TFile,clear:boolean):Promise<void>=>{
   if(!m.active)return load(file,clear);
   if(!this.valid(m) || file!==m.file)return;
   if(!clear && (this.dirty(m) || !this.idle(m))) {m.incoming=true;return;}
   const generation=m.generation;
   m.incoming=true;const pending=load(file,clear);m.pending.add(pending);
   try{await pending;if(generation!==m.generation)throw new Error('Canvas load owner changed');if(this.valid(m) && !this.dirty(m) && this.idle(m) && typeof v.lastSavedData==='string' && this.port.key(JSON.parse(v.lastSavedData))===m.baseline)m.incoming=false;}finally{m.pending.delete(pending);}
  };
  this.wrap(v,'loadFileInternal',reload,m);
  this.wrap(v,'setData',(text:string,clear:boolean)=>{
   if(!m.active)return set(text,clear);
   if(!this.valid(m))return;
   if(!clear && (this.dirty(m) || !this.idle(m)) && this.scene(v)!==this.port.key(JSON.parse(text))) {
    v.lastSavedData=m.raw;m.incoming=true;this.warn(g);return;
   }
   m.applying++;try{set(text,clear);}finally{m.applying--;}m.raw=text;m.baseline=this.port.key(JSON.parse(text));m.clean=this.scene(v);m.incoming=false;v.dirty=false;
  },m);
  const save=async(clear=false):Promise<void>=>{
   if(!m.active){await previousSave(clear);return;}
   const generation=m.generation;
   m.cancelTimer();
   if(m.failed)throw new Error('Canvas previous save remains unconfirmed');
   if(!this.valid(m) || !this.canSave(v))throw new Error('Canvas save preflight blocked');
   if(v.canvas.readonly && this.dirty(m))throw new Error('Canvas is read-only');
   let candidate=this.scene(v);
   if(!this.dirty(m)) {if(m.incoming)await v.loadFileInternal(m.file,false);if(clear){if(!this.valid(m) || this.dirty(m) || m.incoming)throw new Error('Canvas changed before clear');v.clear();}return;}
   let attempted=false;
   const work=this.port.write(v,async()=>{
    if(!this.valid(m) || generation!==m.generation || !this.canSave(v))throw new Error('Canvas save owner changed');
    const stored=await this.app.vault.read(m.file);
    if(!this.valid(m))throw new Error('Canvas file changed');
    const storedKey=this.port.key(JSON.parse(stored));
    if(storedKey!==m.baseline && storedKey===this.scene(v)) {
     m.raw=stored;m.baseline=storedKey;m.clean=storedKey;v.lastSavedData=stored;v.data=stored;v.dirty=false;m.incoming=false;this.port.confirmed?.(v,stored);
     if(clear)v.clear();return;
    }
    if(storedKey!==m.baseline)throw new Error('Canvas baseline changed');
    if (!this.valid(m) || !this.canSave(v)) throw new Error('Canvas changed while waiting');
    // Native save serializes canvas.data, which can lag live geometry during a drag.
    candidate=this.port.key(JSON.parse(v.getViewData()));v.dirty=true;attempted=true;
    await m.nativeSave(false);
    const deadline=Date.now()+5000;
    while(v.saving){if(Date.now()>=deadline)throw new Error('Canvas save is still pending');await new Promise<void>(resolve=>getOwnerWindow(v.contentEl).setTimeout(resolve,25));}
    const written=await this.app.vault.read(m.file);
    if(!this.valid(m) || generation!==m.generation || this.port.key(JSON.parse(written))!==candidate)throw new Error('Canvas save not confirmed');
    m.raw=written;m.baseline=candidate;m.clean=candidate;v.dirty=this.dirty(m);m.failed=false;m.failure=null;
    for(const peer of g.members.values())if(peer!==m && this.valid(peer)) {
     if(this.scene(peer.view)===candidate) {peer.raw=written;peer.baseline=candidate;peer.clean=candidate;peer.view.lastSavedData=written;peer.view.data=written;peer.incoming=false;}
     else if(!this.dirty(peer) && this.idle(peer))await peer.view.loadFileInternal(peer.file,false);
     else peer.incoming=true;
    }
    if(clear && this.scene(v)===candidate)v.clear();
   });
   m.pending.add(work);
   try{await work;}catch(error){if(attempted){m.failed=true;m.failure=candidate;v.dirty=true;m.cancelTimer();}throw error;}finally{m.pending.delete(work);this.reconcile();}
  };
  this.wrap(v,'save',save,m);
  const schedule=debounce(()=>{void v.save().catch(()=>{new Notice(t('notifications','canvasTaskSaveFailed'));});},2000);
  m.cancelTimer=()=>schedule.cancel();
  m.schedule=()=>schedule();
  this.wrap(v,'requestSave',()=>{if(!m.active){previousRequest();return;}if(m.applying)return;v.dirty=true;this.queue(g);},m);
  const settle=():void=>{queueMicrotask(()=>{if(m.active && m.incoming && this.valid(m) && !this.dirty(m) && this.idle(m))void reload(m.file,false).catch(()=>{});});};
  for(const event of ['pointerup','pointercancel','focusout','keyup']){v.contentEl.addEventListener(event,settle);m.restore.push(()=>v.contentEl.removeEventListener(event,settle));}
  m.restore.push(()=>schedule.cancel());
  // A normal peer must also retain its buffer on close/navigation conflicts.
  if(!getNativeLightboxLeaves(this.app).includes(m.leaf)) {
   const detach=bindNativeLightboxMethod(m.leaf,'detach'),change=bindNativeLightboxMethod(m.leaf,'setViewState');
   this.wrap(m.leaf,'detach',()=>{if(!m.active){detach();return;}void this.prepare(m.leaf).then(ok=>{if(ok){m.closing=true;detach();}});},m);
   this.wrap(m.leaf,'setViewState',async(...args:Parameters<WorkspaceLeaf['setViewState']>)=>{
    if(!m.active){await change(...args);return;}
    if(!await this.prepare(m.leaf))return;
    await change(...args);
   },m);
  }
 }
 private queue(g:Group):void {
  const first=[...g.members.keys()][0];if(!first)return;
  if (!this.canSave(first)) {for(const m of g.members.values())m.cancelTimer();return;}
  for(const m of g.members.values()) {
   if(this.valid(m) && this.dirty(m) && m.view.dirty && !m.failed)m.schedule();
   else m.cancelTimer();
  }
 }
 async prepare(leaf: WorkspaceLeaf):Promise<boolean> {
  const v=leaf.view as unknown as TaskCanvasView,g=this.group(v),m=g?.members.get(v);
  if(!g || !m || !m.ready)return true;
  if(!this.canSave(v,true)) {this.warn(g);return false;}
  await Promise.all([...g.members.values()].flatMap(p=>[...p.pending]).map(p=>p.catch(()=>undefined)));
  if(!this.valid(m))return false;
  if(m.failed) {
   try {
    const stored=await this.app.vault.read(m.file),key=this.port.key(JSON.parse(stored));
    const original=key===m.baseline && this.scene(m.view)===m.clean;
    if(!original && (key!==m.failure || this.scene(m.view)!==key))return false;
    m.raw=stored;m.baseline=key;if(!original)m.clean=key;m.view.lastSavedData=stored;m.view.data=stored;m.failed=false;m.failure=null;this.port.confirmed?.(m.view,stored);
   }catch{return false;}
  }
  try {
   if(!this.idle(m))return false;
   if(this.dirty(m)) {
    // Native save reads canvas.data, not live nodes. After interaction settles,
    // flush through the native/plugin request path without adding a history step.
    m.view.canvas.requestSave(false);
    await m.view.save();
   }
   if(m.incoming && !this.dirty(m))await m.view.loadFileInternal(m.file,false);
   return this.valid(m) && !m.failed && !m.incoming && this.idle(m) && !this.dirty(m) && !this.conflict(g);
  }catch{return false;}
 }
 reconcile():void {
  const owned=new Set(getNativeLightboxLeaves(this.app));
  for(const g of this.groups.values()) {
   for(const leaf of g.owners)if(!owned.has(leaf))g.owners.delete(leaf);
   const current=new Set(getCanvasWorkspaceLeaves(this.app));
   for (const m of [...g.members.values()]) if(!current.has(m.leaf) && !m.pending.size && !m.closing)this.removeMember(g,m);
   for(const m of g.members.values())if(m.file===m.view.file && m.path!==m.file.path && !m.renaming)void this.rename(g,m);
   const owner=[...g.owners][0];
   if(owner && !g.opening && [...current].some(l=>(l.view as unknown as TaskCanvasView).file===g.file && !g.members.has(l.view as unknown as TaskCanvasView)))void this.ready(owner,()=>this.active && getNativeLightboxLeaves(this.app).includes(owner)).catch(()=>{});
   if(!g.owners.size && !g.opening && ![...g.members.values()].some(m=>m.pending.size || m.closing || this.dirty(m)))this.release(g);
  }
 }
 private async rename(g:Group,m:Member):Promise<void> {
  m.renaming=true;m.cancelTimer();
  try {
   await Promise.all([...m.pending].map(p=>p.catch(()=>undefined)));
   if(!m.active || m.view.file!==m.file || this.app.vault.getAbstractFileByPath(m.file.path)!==m.file)return;
   const path=m.file.path,stored=await this.app.vault.read(m.file),key=this.port.key(JSON.parse(stored));
   if(path!==m.file.path || key!==m.baseline && key!==this.scene(m.view))return;
   m.path=path;m.generation++;
   if(key===this.scene(m.view)){m.baseline=key;m.clean=key;m.raw=stored;m.view.lastSavedData=stored;m.view.data=stored;this.port.confirmed?.(m.view,stored);}
  }catch{this.warn(g);}finally{m.renaming=false;this.queue(g);}
 }
 private removeMember(g:Group,m:Member):void {
  m.active=false;m.generation++;m.cancelTimer();for(const undo of m.restore.splice(0).reverse())undo();this.admitted.delete(m.view);g.members.delete(m.view);
  if(!m.ready && getNativeLightboxLeaves(this.app).includes(m.leaf))this.protectPending(m.view);
 }
 private release(g:Group):void {
  if(this.groups.get(g.file)!==g)return;
  for(const m of [...g.members.values()])this.removeMember(g,m);
  this.groups.delete(g.file);
  if(this.active)queueMicrotask(()=>{if(this.active)notifyNativeLightboxView(this.app);});
 }
 dispose():void {
  this.active=false;
  for(const g of [...this.groups.values()]) {
   for(const m of g.members.values())m.cancelTimer();
   const pending=[...g.members.values()].flatMap(m=>[...m.pending]);
   if(pending.length)void Promise.allSettled(pending).then(()=>this.release(g));else this.release(g);
  }
 }
}
