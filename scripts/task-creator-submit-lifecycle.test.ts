import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire as createTestRequire } from 'node:module';
import type { ClassDeclaration, MethodDeclaration } from 'typescript';
const testRequire = createTestRequire(process.cwd() + '/package.json');
const ts = testRequire('typescript') as typeof import('typescript');
const {after} = testRequire('node:test') as {after: (cleanup: () => void) => void};
import { App, Notice } from 'obsidian';
const noticeProbe = Notice as unknown as {onNotice: ((message: string) => void) | null};
import { TaskCreatorModal, createEmptyTaskCreatorDraft } from '../src/ui/task-creator-modal';
import { DEFAULT_SETTINGS } from '../src/types/settings';
import type { PreparedCreatorResult } from '../src/ui/task-creator-prepared-draft';

function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((r,j) => { resolve = r; reject = j; }); return {promise,resolve,reject}; }
const source = ts.createSourceFile('main.ts', readFileSync('main.ts','utf8'), ts.ScriptTarget.Latest, true);
const plugin = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'OperonPlugin') as ClassDeclaration;
const restore = plugin.members.find(node => node.name?.getText(source) === 'restoreBackgroundTaskCreator') as MethodDeclaration;
const js = ts.transpileModule(`function restore() ${restore.body!.getText(source)}`, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const restoreBackground = new Function(`${js};return restore;`)() as (this: any) => void;

async function fixture(mode: 'inline' | 'file' = 'inline', onStateChange?: () => void) {
 const started = deferred<void>(), result = deferred<boolean | PreparedCreatorResult>();
 let calls=0, removed=0, reopened=0, releasedBackdrop=0, releasedScope=0, unsubscribed=0, cancelled=0, hidden=false;
 const m: any = new TaskCreatorModal(new App(), {
  settings:structuredClone(DEFAULT_SETTINGS),allTasks:[],initialDraft:{...createEmptyTaskCreatorDraft(),description:'Task',note:'Keep note'},initialCreateType:mode,
  fileTaskTemplateOptions:[{id:'A',name:'A',path:'A',kind:'folder'}],
  preparedAdapter:{properties:{keyMappings:DEFAULT_SETTINGS.keyMappings,propertyTypes:{Client:'text'}},readTemplate:async()=> '---\nClient: original\n---\nBody',clock:()=>({now:'2026-10-22T12:00:00'}),parent:()=>null,candidates:()=>[],onSubmit:()=>{calls++;started.resolve();return result.promise;}},
  onSubmitInline:()=>assert.fail('legacy route'),onSubmitFile:()=>assert.fail('legacy route'),onCancel:()=>{cancelled++;},onSubmissionStateChange:onStateChange,
 });
 m.renderSubmitControls=()=>{};m.renderFieldButtons=()=>{};m.applyThemeColor=()=>{};m.closeActivePicker=()=>{};m.closeSuggestions=()=>{};
 m.containerEl.addClass=(name:string)=>{if(name==='operon-task-creator-force-hidden')hidden=true;};
 m.containerEl.remove=()=>{removed++;};m.contentEl.querySelectorAll=()=>[];m.open=()=>{reopened++;};
 m.backdropCleanup=()=>{releasedBackdrop++;};m.escapeScopeHandler={};m.scope={unregister:()=>{releasedScope++;}};m.indexUpdatesUnsubscribe=()=>{unsubscribed++;};
 await m.selectPreparedTemplateId('A');m.prepared.applyPayload({Client:'User value'});m.hasOpened=true;
 return {m,started,result,hidden:()=>hidden,counts:()=>({calls,removed,reopened,releasedBackdrop,releasedScope,unsubscribed,cancelled})};
}
const previousWindow = (globalThis as any).window;
(globalThis as any).window = (globalThis as any).activeWindow;
// These tests use the same non-DOM Window shim as the existing Creator suites.
after(()=>{(globalThis as any).window=previousWindow;});

for (const mode of ['inline','file'] as const) test(`${mode} Creator removes UI and scope before background creation; one click writes once`,async()=>{
 const f=await fixture(mode);const before=f.m.prepared.draft.snapshot();
 const pending=f.m.submitPrepared(mode);
 assert.equal(f.m.containerEl.ownerDocument.defaultView, (globalThis as any).activeWindow);
 assert.deepEqual(f.counts(),{calls:0,removed:0,reopened:0,releasedBackdrop:1,releasedScope:1,unsubscribed:1,cancelled:0});
 assert.equal(f.hidden(),true);assert.equal(f.m.isCreatorSessionOpen,true);assert.equal(f.m.hasDetachedSubmission,true);
 await f.m.submitPrepared(mode);await f.started.promise;
 assert.equal(f.counts().removed,1,'only the submitted surface is removed before writer work');
 assert.equal(f.counts().calls,1);assert.deepEqual(f.m.prepared.draft.snapshot(),before);
 f.result.resolve({outcome:'committed'});await pending;
 assert.equal(f.m.isCreatorSessionOpen,false);assert.equal(f.m.hasDetachedSubmission,false);assert.equal(f.counts().reopened,0);assert.equal(f.counts().cancelled,0);
});
for (const outcome of ['failed','preview','uncertain'] as const) test(`Creator ${outcome} preserves the exact draft and existing notice without adding a warning`,async()=>{
 const f=await fixture();const before=f.m.prepared.draft.snapshot();const notices:string[]=[];const original=noticeProbe.onNotice;noticeProbe.onNotice=message=>notices.push(message);
 try {
  const pending=f.m.submitPrepared('inline');await f.started.promise;
  f.result.resolve({outcome,message:'Existing result'});await pending;
  assert.deepEqual(f.m.prepared.draft.snapshot(),before);assert.equal(f.counts().reopened,1);assert.equal(f.counts().calls,1);
  assert.deepEqual(notices,['Existing result']);assert.equal(f.m.preparedUncertain,outcome==='uncertain');
  if(outcome==='uncertain'){await f.m.submitPrepared('inline');assert.equal(f.counts().calls,1);}
 } finally { noticeProbe.onNotice=original; }
});
test('Creator failure without a message restores its draft without a new Notice',async()=>{
 const f=await fixture();const notices:string[]=[];const original=noticeProbe.onNotice;noticeProbe.onNotice=message=>notices.push(message);
 try {const pending=f.m.submitPrepared('inline');await f.started.promise;f.result.resolve({outcome:'failed'});await pending;assert.deepEqual(notices,[]);assert.equal(f.counts().reopened,1);}finally{noticeProbe.onNotice=original;}
});
test('closing a detached session before its scheduled write prevents creation and draft revival',async()=>{
 const f=await fixture();const pending=f.m.submitPrepared('inline');f.m.completeAndClose();await pending;
 assert.equal(f.m.isCreatorSessionOpen,false);assert.equal(f.counts().calls,0);assert.equal(f.counts().reopened,0);
});
test('late results after unload cannot reopen the Creator or show a stale Notice',async()=>{
 const f=await fixture();const pending=f.m.submitPrepared('inline');await f.started.promise;f.m.completeAndClose();
 const notices:string[]=[];const original=noticeProbe.onNotice;noticeProbe.onNotice=message=>notices.push(message);
 try{f.result.resolve({outcome:'failed',message:'Stale'});await pending;assert.equal(f.counts().reopened,0);assert.deepEqual(notices,[]);}finally{noticeProbe.onNotice=original;}
});
for (const outcome of ['committed','failed'] as const) test(`old ${outcome} result leaves a newer Creator untouched`,async()=>{
 const owner:any={backgroundTaskCreators:new Set(),preparingTaskCreators:new Set()};
 const f=await fixture('inline',()=>{if(f.m.hasDetachedSubmission&&f.m.isCreatorSessionOpen)owner.backgroundTaskCreators.add(f.m);else owner.backgroundTaskCreators.delete(f.m);restoreBackground.call(owner);});
 owner.taskCreatorModal=f.m;
 const close=f.m.onClose.bind(f.m);f.m.onClose=()=>{close();if(owner.taskCreatorModal===f.m)owner.taskCreatorModal=null;restoreBackground.call(owner);};
 const pending=f.m.submitPrepared('inline');await f.started.promise;
 const newer={draft:'New draft'};owner.taskCreatorModal=newer;
 f.result.resolve({outcome});await pending;assert.equal(owner.taskCreatorModal,newer);assert.equal(newer.draft,'New draft');assert.equal(f.counts().reopened,0);
 owner.taskCreatorModal=null;owner.preparingTaskCreators.add(1);restoreBackground.call(owner);assert.equal(f.counts().reopened,0);
 owner.preparingTaskCreators.clear();restoreBackground.call(owner);
 assert.equal(f.counts().reopened,outcome==='failed'?1:0);
});
test('pending Creator cleanup removes only its own artifacts',async()=>{
 const f=await fixture();let touched=0;const original=f.m.containerEl.ownerDocument.querySelectorAll;f.m.containerEl.ownerDocument.querySelectorAll=()=>{touched++;return[];};
 try{f.m.hideImmediately();f.m.removeCurrentModalArtifacts();assert.equal(touched,0);assert.equal(f.counts().removed,1);}finally{f.m.containerEl.ownerDocument.querySelectorAll=original;}
});


test('delayed native phone close waits to restore a failed draft without canceling its session',async()=>{
 const f=await fixture();const close=f.m.onClose.bind(f.m);f.m.onClose=()=>{};
 const pending=f.m.submitPrepared('inline');await f.started.promise;
 assert.equal(f.m.isCreatorSessionOpen,true);f.result.resolve({outcome:'failed'});await pending;
 assert.equal(f.counts().reopened,0);assert.equal(f.m.canRestoreSubmittedDraft,false);
 close();assert.equal(f.counts().reopened,1);assert.equal(f.m.isCreatorSessionOpen,true);
});
test('command toggle opens a new Creator while a detached phone modal is still closing',()=>{
 const method=plugin.members.find(node=>node.name?.getText(source)==='toggleTaskCreatorFromCommand') as MethodDeclaration;
 const body=ts.transpileModule(`function toggle() ${method.body!.getText(source)}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const toggle=new Function(`${body};return toggle;`)();let opened=0,escape=0;
 for(const state of [{hasDetachedSubmission:true,isCreatorSessionOpen:true},{hasDetachedSubmission:false,isCreatorSessionOpen:false}])toggle.call({taskCreatorModal:{...state,requestEscapeClose:()=>{escape++;}},openTaskCreator:()=>{opened++;}});
 assert.equal(opened,2);assert.equal(escape,0);
});


test('unexpected submission rejection preserves the draft and existing console handling without a new warning',async()=>{
 const f=await fixture();const before=f.m.prepared.draft.snapshot();const original=console.error,notice=noticeProbe.onNotice;let errors=0;const notices:string[]=[];
 console.error=()=>{errors++;};noticeProbe.onNotice=message=>notices.push(message);
 try{const pending=f.m.submitPrepared('inline');await f.started.promise;f.result.reject(new Error('Existing failure'));await pending;assert.equal(errors,1);assert.deepEqual(notices,[]);assert.deepEqual(f.m.prepared.draft.snapshot(),before);assert.equal(f.counts().reopened,1);}finally{console.error=original;noticeProbe.onNotice=notice;}
});
