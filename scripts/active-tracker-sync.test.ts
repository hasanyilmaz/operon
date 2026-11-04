import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { ActiveTrackerStore } from '../src/storage/active-tracker-store';
import { WriteQueue } from '../src/storage/write-queue';
import { TimeTracker } from '../src/systems/time-tracker';
import { startActiveTrackerMonitor } from '../src/systems/active-tracker-monitor';
import { DEFAULT_SETTINGS } from '../src/types/settings';
import type { ActiveTrackerRecord } from '../src/types/tracker';
import type { IndexedTask } from '../src/types/fields';

// The store uses the main browser window for its I/O timeout, independent of popouts.
Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis });

const file = 'config/plugins/operon/state/active-trackers.json';
const start = '2026-11-04T10:00:00';
const end = '2026-11-04T10:01:00';
function record(taskId: string | null = 'task-a', id = 'remote-a'): ActiveTrackerRecord {
 return { id, userId: '', userName: '', taskId, start, source: 'command', createdAt: start, updatedAt: start };
}
function text(records: ActiveTrackerRecord[]): string { return JSON.stringify({ version: 1, active: records }); }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
class Adapter {
 files = new Map<string,string>(); reads = 0; writes = 0; readFails = false; writeFails = false;
 readGate: ReturnType<typeof deferred> | null = null;
 processGate: ReturnType<typeof deferred> | null = null;
 beforeProcess: (() => void) | null = null;
 async exists(path: string) { return this.files.has(path); }
 async read(path: string) { this.reads++; if (this.readFails) throw new Error('hydrating'); const value = this.files.get(path); const gate = this.readGate; this.readGate = null; if (gate) await gate.promise; if (value === undefined) throw new Error('missing'); return value; }
 async write(path: string, value: string) { if (this.writeFails) throw new Error('disk failed'); this.writes++; this.files.set(path,value); }
 async process(path: string, update: (value: string) => string) { const gate = this.processGate; this.processGate = null; if (gate) await gate.promise; this.beforeProcess?.(); await this.write(path,update(this.files.get(path)!)); }
 async remove(path: string) { this.files.delete(path); }
 async rename(from: string, to: string) { const value = this.files.get(from); assert.notEqual(value,undefined); this.files.set(to,value!); this.files.delete(from); }
 async mkdir() {}
}
async function store(adapter = new Adapter(), initial?: ActiveTrackerRecord[]) {
 if (initial) adapter.files.set(file,text(initial));
 const value = new ActiveTrackerStore({ vault: { adapter, configDir: 'config' } } as never, new WriteQueue());
 await value.load(); return { value, adapter };
}
function trackerFixture(value: ActiveTrackerStore) {
 const intervals = new Set<() => void>();
 Object.defineProperty(globalThis,'activeWindow',{configurable:true,value:{setInterval:(f:()=>void)=>{intervals.add(f);return f;},clearInterval:(f:()=>void)=>intervals.delete(f)}});
 const tasks = new Map<string,IndexedTask>(['task-a','task-b'].map(id=>[id,{operonId:id,description:id,checkbox:'open',fieldValues:{},primary:{format:'inline',filePath:`${id}.md`,lineNumber:0}} as IndexedTask]));
 const writes: Array<{id:string;fields:Record<string,string>}> = [];
 let writerGate: ReturnType<typeof deferred> | null = null;
 const settings = {...DEFAULT_SETTINGS,pipelines:[],defaultPipelineName:''};
 const tracker = new TimeTracker({} as never,{getTask:(id:string)=>tasks.get(id),getAllTasks:()=>[...tasks.values()],reindexFilePath:async()=>{},hasDuplicateOperonIdConflict:()=>false} as never,
  {writeTaskFields:async(id:string,fields:Record<string,string>)=>{ if(writerGate) { const gate=writerGate;writerGate=null;await gate.promise; } writes.push({id,fields});Object.assign(tasks.get(id)!.fieldValues,fields);return true;}} as never,
  value,()=>settings,undefined,async()=>{});
 const events: Array<{event:string;source:string}> = []; let created = 0;
 tracker.subscribe((event,context)=>events.push({event,source:context?.source??'local'}));
 tracker.subscribeSessionCreated(()=>created++);
 return {tracker,tasks,writes,events,intervals,get created(){return created;},setWriterGate:(gate:ReturnType<typeof deferred>)=>{writerGate=gate;}};
}

test('two stores receive start, switch, unassigned and stop without echo writes',async()=>{
 const a=await store(); const b=await store(a.adapter); let notifications=0;b.value.subscribe(()=>notifications++);
 for(const taskId of ['task-a','task-b',null]) {
  await a.value.setActiveForUser({taskId,start,source:'command'});const writes=a.adapter.writes;
  assert.equal(await b.value.refreshFromDisk(),'changed');assert.equal(b.value.getActiveForUser()?.taskId,taskId);
  assert.equal(await b.value.refreshFromDisk(),'unchanged');assert.equal(a.adapter.writes,writes);
 }
 await a.value.clearActiveForUser(); const writes=a.adapter.writes;assert.equal(await b.value.refreshFromDisk(),'changed');assert.equal(b.value.getActiveForUser(),null);
 assert.equal(notifications,4);assert.equal(b.value.getGeneration(),4);assert.equal(a.adapter.writes,writes);
 // Same transport, reverse device direction.
 await b.value.setActiveForUser({taskId:'task-a',start,source:'editor'});assert.equal(await a.value.refreshFromDisk(),'changed');assert.equal(a.value.getActiveForUser()?.taskId,'task-a');
});

test('equal-size content changes and formatting-only echoes use semantic comparison',async()=>{
 const h=await store(new Adapter(),[record()]);const first=text([record()]);const second=text([record('task-b')]);assert.equal(first.length,second.length);
 h.adapter.files.set(file,second);assert.equal(await h.value.refreshFromDisk(),'changed');
 const revision=h.value.getGeneration();h.adapter.files.set(file,JSON.stringify(JSON.parse(second),null,2));assert.equal(await h.value.refreshFromDisk(),'unchanged');assert.equal(h.value.getGeneration(),revision);assert.equal(h.adapter.writes,0);
});

for(const mode of ['missing','partial','unsupported','wrong-shape','invalid-record','duplicate-user','duplicate-id','read-error'] as const) test(`transient ${mode} preserves last valid state and never repairs`,async()=>{
 const h=await store(new Adapter(),[record()]);
 if(mode==='missing')h.adapter.files.delete(file);
 if(mode==='partial')h.adapter.files.set(file,'{"version":1,');
 if(mode==='unsupported')h.adapter.files.set(file,JSON.stringify({version:2,active:[]}));
 if(mode==='wrong-shape')h.adapter.files.set(file,JSON.stringify({version:1,active:{}}));
 if(mode==='invalid-record')h.adapter.files.set(file,text([{...record(),start:'invalid'}]));
 if(mode==='duplicate-user')h.adapter.files.set(file,text([record(),record('task-b','other')]));
 if(mode==='duplicate-id')h.adapter.files.set(file,text([record(),{...record('task-b'),userId:'other'}]));
 if(mode==='read-error')h.adapter.readFails=true;
 assert.equal(await h.value.refreshFromDisk(),'unavailable');assert.equal(h.value.getActiveForUser()?.taskId,'task-a');assert.equal(h.value.getGeneration(),0);assert.equal(h.adapter.writes,0);
 await assert.rejects(h.value.clearActiveForUser());assert.equal(h.adapter.writes,0);
 h.adapter.readFails=false;h.adapter.files.set(file,text([]));assert.equal(await h.value.refreshFromDisk(),'changed');assert.equal(h.value.getActiveForUser(),null);
});

test('first missing file permits first local start; subsequent disappearance does not',async()=>{
 const h=await store();assert.equal(await h.value.refreshFromDisk(),'unchanged');await h.value.setActiveForUser({taskId:null,start,source:'command'});
 assert.equal(await h.value.refreshFromDisk(),'unchanged');h.adapter.files.delete(file);assert.equal(await h.value.refreshFromDisk(),'unavailable');await assert.rejects(h.value.clearActiveForUser());
});

test('refresh queued behind local write observes committed content, not older buffer',async()=>{
 const h=await store(new Adapter(),[]);const gate=deferred();h.adapter.processGate=gate;
 const write=h.value.setActiveForUser({taskId:'task-a',start,source:'command'});const refresh=h.value.refreshFromDisk();gate.resolve();await write;
 assert.equal(await refresh,'unchanged');assert.equal(h.value.getChangeSource(),'local');assert.equal(h.value.getGeneration(),1);
});

test('source change inside native process rejects write without replacing remote record',async()=>{
 const h=await store(new Adapter(),[record()]);h.adapter.beforeProcess=()=>h.adapter.files.set(file,text([record('task-b','b')]));
 await assert.rejects(h.value.clearActiveForUser(),/source changed/);assert.equal(h.adapter.writes,0);assert.equal(JSON.parse(h.adapter.files.get(file)!).active[0].taskId,'task-b');
});

test('atomic replacement rechecks remote source before replacing the original',async()=>{
 const h=await store(new Adapter(),[record()]);Object.defineProperty(h.adapter,'process',{value:undefined});
 const write=h.adapter.write.bind(h.adapter);h.adapter.write=async(path,value)=>{await write(path,value);if(path.includes('.tmp-'))h.adapter.files.set(file,text([record('task-b','b')]));};
 await assert.rejects(h.value.clearActiveForUser(),/source changed/);assert.equal(JSON.parse(h.adapter.files.get(file)!).active[0].taskId,'task-b');assert.equal([...h.adapter.files.keys()].length,1);
});

test('write failure keeps memory and generation unchanged without retry',async()=>{
 const h=await store(new Adapter(),[record()]);h.adapter.writeFails=true;await assert.rejects(h.value.clearActiveForUser());assert.equal(h.value.getActiveForUser()?.taskId,'task-a');assert.equal(h.value.getGeneration(),0);
});

test('external start and stop notify all subscribers, manage ticking and create no sessions',async()=>{
 const h=await store();const f=trackerFixture(h.value);try{
  h.adapter.files.set(file,text([record()]));await f.tracker.refreshExternalState();assert.equal(f.tracker.getActiveState()?.operonId,'task-a');assert.equal(f.intervals.size,1);
  await f.tracker.resumeFromIndex();assert.ok(f.events.every(e=>e.source==='external'));
  h.adapter.files.set(file,text([]));await f.tracker.refreshExternalState();assert.equal(f.tracker.getActiveState(),null);assert.equal(f.intervals.size,0);
  assert.equal(f.created,0);assert.equal(f.writes.length,0);assert.equal(h.adapter.writes,0);
 }finally{f.tracker.destroy();}
});

test('unresolved task survives refresh, index reconciliation and Stop until task arrives',async()=>{
 const h=await store();const f=trackerFixture(h.value);const task=f.tasks.get('task-a')!;f.tasks.delete('task-a');try{
  h.adapter.files.set(file,text([record()]));await f.tracker.refreshExternalState();await f.tracker.resumeFromIndex();assert.equal(await f.tracker.stop('manual',end),false);
  assert.equal(h.value.getActiveForUser()?.taskId,'task-a');assert.equal(h.adapter.writes,0);assert.equal(f.tracker.getActiveState(),null);
  f.tasks.set('task-a',task);await f.tracker.resumeFromIndex();assert.equal(f.tracker.getActiveState()?.operonId,'task-a');assert.equal(f.events.at(-1)?.source,'external');
 }finally{f.tracker.destroy();}
});

test('startup unresolved disk record is preserved; confirmed deletion still clears it',async()=>{
 const h=await store(new Adapter(),[record()]);const f=trackerFixture(h.value);f.tasks.delete('task-a');try{
  await f.tracker.resumeFromIndex();assert.equal(h.value.getActiveForUser()?.taskId,'task-a');
  await f.tracker.confirmTaskRemoval(['task-b']);assert.equal(h.adapter.writes,0);
  await f.tracker.confirmTaskRemoval(['task-a']);assert.equal(h.value.getActiveForUser(),null);assert.equal(h.adapter.writes,1);
 }finally{f.tracker.destroy();}
});

for(const action of ['start','stop','unassigned'] as const)test(`stale ${action} action refreshes but does not act on a new timer`,async()=>{
 const h=await store(new Adapter(),[record()]);const f=trackerFixture(h.value);try{
  h.adapter.files.set(file,text([record('task-b','b')]));
  const result=action==='stop'?await f.tracker.stop('manual',end):action==='start'?await f.tracker.start('task-a'):await f.tracker.startUnassigned();
  assert.equal(result,false);assert.equal(f.tracker.getActiveState()?.operonId,'task-b');assert.equal(f.writes.length,0);assert.equal(h.adapter.writes,0);
 }finally{f.tracker.destroy();}
});

test('queued stale Stop cannot follow an earlier external refresh onto the new timer',async()=>{
 const h=await store(new Adapter(),[record()]);const f=trackerFixture(h.value);try{
  const gate=deferred();h.adapter.files.set(file,text([record('task-b','b')]));h.adapter.readGate=gate;
  const refresh=f.tracker.refreshExternalState();const stop=f.tracker.stop('manual',end);gate.resolve();await refresh;assert.equal(await stop,false);assert.equal(h.adapter.writes,0);
 }finally{f.tracker.destroy();}
});

test('local session saved during incoming change is preserved; remote tracker is not cleared or retried',async()=>{
 const h=await store(new Adapter(),[record()]);const f=trackerFixture(h.value);try{
  const gate=deferred();f.setWriterGate(gate);const stop=f.tracker.stop('manual',end);
  // Wait until the real writer has been reached, without timers or guessing I/O duration.
  for(let i=0;i<30;i++)await Promise.resolve();
  h.adapter.files.set(file,text([record('task-b','b')]));gate.resolve();assert.equal(await stop,false);
  assert.equal(f.writes.length,1);assert.ok(f.tasks.get('task-a')!.fieldValues.trackers);assert.equal(f.tracker.getActiveState()?.operonId,'task-b');assert.equal(h.adapter.writes,0);
 }finally{f.tracker.destroy();}
});

test('unload invalidates delayed refresh and coalesced probes do not duplicate reads',async()=>{
 const h=await store();const f=trackerFixture(h.value);try{
  h.adapter.files.set(file,text([record()]));const gate=deferred();h.adapter.readGate=gate;
  const first=f.tracker.refreshExternalState();assert.equal(f.tracker.refreshExternalState(),first);
  for(let i=0;i<5;i++)await Promise.resolve();f.tracker.cancelExternalRefresh();gate.resolve();assert.equal(await first,'unavailable');assert.equal(h.value.getActiveForUser(),null);assert.equal(f.events.length,0);
 }finally{f.tracker.destroy();}
});

test('event monitor has no polling, coalesces events, follows in-flight changes and disposes',async()=>{
 class Target extends EventTarget { hidden=false; }
 const doc=new Target();const win=new Target();const timers=new Map<number,()=>void>();let serial=0;let raw:(path:unknown)=>void=()=>{};let removed=false;let calls=0;let gate:ReturnType<typeof deferred>|null=null;
 Object.assign(win,{setInterval:()=>{throw new Error('Polling forbidden');},setTimeout:(fn:()=>void,delay:number)=>{assert.equal(delay,100);timers.set(++serial,fn);return serial;},clearTimeout:(id:number)=>timers.delete(id)});
 const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
 const fire=()=>{const entries=[...timers.values()];timers.clear();for(const fn of entries)fn();};
 const dispose=startActiveTrackerMonitor({refreshExternalState:async()=>{calls++;if(gate)await gate.promise;return 'unchanged';}},win as unknown as Window,doc as unknown as Document,()=>true,{path:file,vault:{on:(_name:string,fn:typeof raw)=>{raw=fn;return {}},offref:()=>{removed=true;}} as never});
 await flush();assert.equal(calls,1);assert.equal(timers.size,0);
 raw('unrelated.md');raw(file+'.tmp');assert.equal(timers.size,0);
 raw(file);raw(file);assert.equal(timers.size,1);fire();await flush();assert.equal(calls,2);assert.equal(timers.size,0);
 gate=deferred();raw(file);fire();await flush();raw(file);raw(file);assert.equal(timers.size,0);gate.resolve();gate=null;await flush();assert.equal(timers.size,1);fire();await flush();assert.equal(calls,4);assert.equal(timers.size,0);
 doc.hidden=true;raw(file);win.dispatchEvent(new Event('focus'));assert.equal(timers.size,0);assert.equal(calls,4);
 doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));await flush();assert.equal(calls,5);
 raw(file.slice(0,file.lastIndexOf('/')));assert.equal(timers.size,1);dispose();assert.equal(timers.size,0);raw(file);win.dispatchEvent(new Event('focus'));await flush();assert.equal(calls,5);assert.equal(removed,true);
});

test('main routes imported state to UI without replaying pin/archive; Runtime refreshes before guards',()=>{
 const main=readFileSync('main.ts','utf8');
 assert.ok(main.includes("this.reconcileFileTaskArchiveAfterTimerStateChange(context?.source);"));
 assert.ok(main.includes("if (event !== 'state' || context?.source === 'external') return;"));
 assert.ok(main.includes('this.refreshTimerStateSurfaces();'));
 const prepare=main.slice(main.indexOf("if (request.spec.operation === 'start' || request.spec.operation === 'stop')"));
 assert.ok(prepare.indexOf('refreshExternalState()')<prepare.indexOf('guardRuntimeTimerControlV1'));
 const commit=main.slice(main.indexOf('const prepared = preparedMutation.token as RuntimeTimerMutationPreparationV1;'));
 assert.ok(commit.indexOf('refreshExternalState()')<commit.indexOf('prepared.expectedActive'));
});


test('startup recovery permits explicit writes only over the exact preserved source',async()=>{
 for(const malformed of [true,false]) {
  const adapter=new Adapter();const original=malformed?'broken':JSON.stringify({version:1,active:[{start,taskId:'task-a'}]});adapter.files.set(file,original);
  const h=await store(adapter);assert.equal(await h.value.refreshFromDisk(),'unchanged');await h.value.setActiveForUser({taskId:'task-b',start,source:'command'});
  assert.equal(h.value.getActiveForUser()?.taskId,'task-b');assert.equal(await h.value.refreshFromDisk(),'unchanged');
  if(malformed)assert.ok([...adapter.files.keys()].some(path=>path.includes('.invalid-')));
  adapter.files.set(file,'new malformed');assert.equal(await h.value.refreshFromDisk(),'unavailable');await assert.rejects(h.value.clearActiveForUser());
 }
});

test('external archive cursor updates without side effects and next local stop targets correct task',()=>{
 const main=readFileSync('main.ts','utf8');const section=main.slice(main.indexOf('private reconcileFileTaskArchiveAfterTimerStateChange('),main.indexOf('private async startUnassignedTimer('));
 const body=section.slice(section.indexOf('{')+1,section.lastIndexOf('}'));
 const archived:string[]=[];let active:string|null='a';const context={lastActiveTimerTaskId:null as string|null,timeTracker:{getActiveOperonId:()=>active},fileTaskArchiver:{scheduleAfterTimerFinalized:(id:string)=>archived.push(id)}};
 const reconcile=new Function('source',body).bind(context);
 reconcile('local');active='b';reconcile('external');assert.equal(context.lastActiveTimerTaskId,'b');assert.deepEqual(archived,[]);
 active=null;reconcile('local');assert.deepEqual(archived,['b']);
 active='a';reconcile('external');active=null;reconcile('external');active='c';reconcile('local');assert.deepEqual(archived,['b']);
});

test('unresolved active task is distinct from idle and Runtime checks readiness',async()=>{
 const h=await store(new Adapter(),[record()]);const f=trackerFixture(h.value);try{
  f.tasks.delete('task-a');assert.equal(f.tracker.hasUnresolvedActiveTask(),true);assert.equal(f.tracker.getActiveState(),null);
  const main=readFileSync('main.ts','utf8');assert.equal((main.match(/refreshExternalState\(\) === 'unavailable' \|\| this.timeTracker.hasUnresolvedActiveTask\(\)/g)??[]).length,2);
 }finally{f.tracker.destroy();}
});

test('monitor uses the stable workspace owner rather than a disposable popout',()=>{
 const main=readFileSync('main.ts','utf8');const start=main.indexOf('private initializeActiveTrackerMonitor()');const body=main.slice(start,main.indexOf('private initializeIndexV8ManifestMonitor()',start));
 assert.ok(body.includes('getOwnerWindow(this.app.workspace.containerEl)'));assert.ok(body.includes('this.app.workspace.containerEl.ownerDocument'));assert.ok(!body.includes('getActiveWindow()'));
});


test('unrelated task removal does not read tracker state or emit warnings',async()=>{
 const h=await store(new Adapter(),[record()]);const f=trackerFixture(h.value);try{
  const reads=h.adapter.reads;h.adapter.readFails=true;await f.tracker.confirmTaskRemoval(['other']);assert.equal(h.adapter.reads,reads);assert.equal(f.events.length,0);
 }finally{f.tracker.destroy();}
});

test('delete-old add-new sync delivery preserves tracker and resumes at the new path',async()=>{
 const h=await store(new Adapter(),[record()]);const f=trackerFixture(h.value);const task=f.tasks.get('task-a')!;try{
  f.tasks.delete('task-a');await f.tracker.resumeFromIndex();assert.equal(h.value.getActiveForUser()?.taskId,'task-a');
  f.tasks.set('task-a',{...task,primary:{...task.primary,filePath:'Moved.md'}});await f.tracker.resumeFromIndex();assert.equal(f.tracker.getActiveState()?.task?.primary.filePath,'Moved.md');assert.equal(h.adapter.writes,0);
  const main=readFileSync('main.ts','utf8');const observer=main.slice(main.indexOf('this.indexer.onTasksRemoved ='),main.indexOf('this.indexer.onTasksChanged ='));assert.ok(!observer.includes('confirmTaskRemoval'));
 }finally{f.tracker.destroy();}
});


test('committed deletion clears its timer even when post-commit index settlement is delayed',async()=>{
 const h=await store(new Adapter(),[record()]);const f=trackerFixture(h.value);try{
  assert.ok(f.tasks.has('task-a'));await f.tracker.confirmTaskRemoval(['task-a']);assert.equal(h.value.getActiveForUser(),null);assert.equal(h.adapter.writes,1);
  f.tasks.delete('task-a');await f.tracker.resumeFromIndex();assert.equal(f.tracker.getActiveState(),null);
 }finally{f.tracker.destroy();}
});


test('hung provider read releases the transition queue, rejects its late snapshot and does not accumulate probes',async()=>{
 const h=await store();const f=trackerFixture(h.value);const originalWindow=window;
 const timers=new Map<number,{callback:()=>void;delay:number}>();let serial=0;
 Object.defineProperty(globalThis,'window',{configurable:true,value:{setTimeout:(callback:()=>void,delay:number)=>{const id=++serial;timers.set(id,{callback,delay});return id;},clearTimeout:(id:number)=>timers.delete(id)}});try{
  h.adapter.files.set(file,text([record()]));const gate=deferred();h.adapter.readGate=gate;
  const refresh=f.tracker.refreshExternalState();for(let i=0;i<10;i++)await Promise.resolve();assert.equal(timers.size,1);for(const timer of [...timers.values()]){assert.equal(timer.delay,3000);timer.callback();}
  assert.equal(await refresh,'unavailable');await f.tracker.flushPendingTransitions();assert.equal(h.value.getActiveForUser(),null);
  const reads=h.adapter.reads;assert.equal(await f.tracker.refreshExternalState(),'unavailable');assert.equal(h.adapter.reads,reads);
  h.adapter.files.set(file,text([record('task-b','b')]));gate.resolve();for(let i=0;i<10;i++)await Promise.resolve();
  assert.equal(h.value.getActiveForUser(),null);assert.equal(await f.tracker.refreshExternalState(),'changed');assert.equal(f.tracker.getActiveState()?.operonId,'task-b');
 }finally{f.tracker.destroy();Object.defineProperty(globalThis,'window',{configurable:true,value:originalWindow});}
});
