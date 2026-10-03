import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import ts from 'typescript';

const root = process.cwd();
const dir = await mkdtemp(path.join(tmpdir(), 'operon-target-picker-'));
try {
 const source = ts.createSourceFile('main.ts', await readFile('main.ts', 'utf8'), ts.ScriptTarget.Latest, true);
 const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'OperonPlugin');
 const method = name => cls.members.find(n => n.name?.getText(source) === name).getText(source);
 const methods = ['isExcalidrawTaskSource', 'recordInlineTaskCreationTarget', 'recordInlineTaskCreationFromEditor', 'insertTaskCreatorInlineTaskAtChosenTarget', 'insertTaskCreatorInlineTaskWithResolvedTarget', 'insertTaskCreatorInlineTaskUsingDefaultTarget', 'createInlineTaskFromCreatorDraftResult', 'openTaskCreator', 'createCalendarInlineTaskFromCreatorDraft', 'createKanbanInlineTaskFromCreatorDraft', 'createInlineSubtaskFromFlexibleCreatorDraft', 'insertTaskCreatorInlineTaskBelowInlineParent', 'insertTaskCreatorInlineTaskInsideFileParent'];
 const stub = path.join(dir, 'obsidian.ts');
 await writeFile(stub, `
export const notices:string[]=[];
export class Notice { constructor(message:string) { notices.push(message); } }
export class TFile { extension='md'; constructor(public path:string){} }
export const setIcon=()=>{};
export const prepareFuzzySearch=(query:string)=>(text:string)=>{const at=text.toLowerCase().indexOf(query.toLowerCase());return at<0?null:{score:100-at};};
export class Modal {
 modalEl:any; titleEl:any; contentEl:any;
 constructor(app:any){this.modalEl=app.root.createDiv();this.titleEl=this.modalEl.createDiv();this.contentEl=this.modalEl.createDiv();}
 open(){this.onOpen();} close(){this.onClose();} onOpen(){} onClose(){}
}
`);
 const input = `
import assert from 'node:assert/strict';
import test from 'node:test';
import { TFile, notices } from 'obsidian';
import { showSearchableOptionPicker, filterSearchableOptions } from './src/ui/field-pickers/searchable-option-picker';
import { promptInlineTaskTarget as realPrompt } from './src/ui/inline-task-target-picker';
import { rankInlineTaskTargets } from './src/core/inline-task-targets';
import { DEFAULT_SETTINGS, normalizeInlineTaskHeadingKeyword, normalizeInlineTaskParentFileHeadingKeyword } from './src/types/settings';
import { indentNewInlineSubtask, resolveInlineParentCheckboxPlacement, resolveTaskCreatorInlinePlacement } from './src/core/task-creator-target-resolver';
import { Notice } from 'obsidian';
import { ExcalidrawSourceError } from './src/ui/excalidraw-markdown-source';
import { insertInlineTaskUnderFirstHeadingKeyword } from './src/core/markdown-heading-insertion';
const localNow=()=> '2026-09-28T12:00';
const t=(_group:string,key:string)=>key;
const isTaskCreatorFieldExplicitlyCleared=(draft:any,key:string)=>draft.explicitEmptyFieldKeys?.includes(key);
const parseFrontmatterDocument=(content:string)=>({managedFieldValues:{operonId:content.match(/operonId: (\\S+)/)?.[1]}});
let chosen:any=null, received:any;
const promptInlineTaskTarget=async (targets:any)=>{received=targets;return typeof chosen==='function'?chosen():chosen;};
class TaskCreatorModal { options:any;onClose:any;constructor(_app:any,options:any){this.options=options;}open(){}close(){this.onClose?.();} }
class Harness {
 recordedInlineCreationIds=new Set();inlineCreatorActiveFiles=new WeakMap();
 ${methods.map(method).join('\n')}
}
class Element {
 children:any[]=[];attrs:any={};events:any={};dataset:any={};classes=new Set();textContent='';value='';scrollTop=0;clientHeight=100;scrollHeight=1000;isConnected=true;
 ownerDocument:any={defaultView:{requestAnimationFrame:(cb:any)=>cb()}};
 classList={toggle:(name:string,yes:boolean)=>{yes?this.classes.add(name):this.classes.delete(name);}};
 constructor(public tag='div'){}
 set className(v:string){this.classes=new Set(v.split(' '));}get className(){return [...this.classes].join(' ');}
 addClass(v:string){this.classes.add(v);}toggleClass(v:string,yes:boolean){this.classList.toggle(v,yes);}
 setText(v:string){this.textContent=v;}setAttribute(k:string,v:string){this.attrs[k]=v;}removeAttribute(k:string){delete this.attrs[k];}
 createEl(tag:string,opts:any={}){const child=new Element(tag);child.ownerDocument=this.ownerDocument;if(opts.cls)child.className=opts.cls;if(opts.text)child.textContent=opts.text;this.children.push(child);return child;}
 createDiv(opts:any=''){return this.createEl('div',typeof opts==='string'?{cls:opts}:opts);}createSpan(opts:any=''){return this.createEl('span',typeof opts==='string'?{cls:opts}:opts);}
 appendChild(child:any){if(!this.children.includes(child))this.children.push(child);}replaceChildren(){this.children=[];}empty(){this.replaceChildren();}
 querySelectorAll(selector:string){return this.children.flatMap(child=>[...(selector==='input'?child.tag==='input':child.classes.has(selector.slice(1)))?[child]:[],...child.querySelectorAll(selector)]);}
 addEventListener(type:string,fn:any){this.events[type]=fn;}fire(type:string,props:any={}){this.events[type]?.({preventDefault(){},...props});}
 getBoundingClientRect(){return {width:400};}
}
(globalThis as any).makePanel=()=>new Element();
const activeBody=new Element();activeBody.ownerDocument.defaultView={innerWidth:1000,innerHeight:800,requestAnimationFrame:(cb:any)=>cb()};(globalThis as any).activeDocument={body:activeBody};
const panel=()=> (globalThis as any).panel;
const rows=()=>panel().querySelectorAll('.operon-searchable-option-picker-item');
const inputEl=()=>panel().querySelectorAll('input')[0];
function setup(){
 notices.length=0;chosen=null;received=null;
 const h:any=new Harness();
 const files=new Map(['Active.md','Parent.md','Other.md'].map(p=>[p,new TFile(p)]));
 const contents=new Map([['Parent.md','---\\noperonId: p\\n---\\n'],['Other.md','']]);
 h.app={metadataCache:{getFileCache:()=>({})},vault:{getMarkdownFiles:()=>[...files.values()],getAbstractFileByPath:(p:string)=>files.get(p),read:async(f:any)=>contents.get(f.path)??''}};
 h.settings={inlineTaskHeading:'Tasks',inlineTaskParentFileHeadingKeyword:'Backlog',inlineTaskParentInlineTargetMode:'below-parent',inlineTaskParentFileTargetMode:'inside-parent-file'};
 const parent={operonId:'p',primary:{format:'yaml',filePath:'Parent.md'}};
 h.indexer={getTask:(id:string)=>id==='p'?parent:null,hasDuplicateOperonIdConflict:()=>false,reindexFilePath:async()=>{},getAllTasks:()=>[],subscribeIndexUpdates:()=>()=>{}};
 h.resolveEffectiveInlineTaskSaveMode=()=> 'ask-every-time';h.inlineTargetHistory={getEntries:()=>[],recordSuccess:async()=>{h.records++;}};h.records=0;
 h.getActiveMarkdownFile=()=>files.get('Active.md');h.resolveTaskCreatorScheduledPeriodicParent=async()=>({attempted:false});
 h.insertTaskCreatorInlineTaskIntoFile=async(file:any,draft:any)=>{h.writes.push(['file',file.path,draft.fieldValues.parentTask]);return {operonId:'new',lineNumber:3};};
 h.insertTaskCreatorInlineTaskInsideFileParent=async(_draft:any,p:any,heading:any,guard:any)=>{if(guard?.()===false)return null;h.writes.push(['parent',p.primary.filePath,heading]);return {operonId:'new',filePath:p.primary.filePath,lineNumber:3};};
 h.insertTaskCreatorInlineTaskBelowInlineParent=async()=>{h.writes.push(['inline-parent']);return {operonId:'new',filePath:'Parent.md',lineNumber:3};};
 h.writes=[];h.showTaskNotice=()=>{};h.finalizeTaskCreatorCreatedTask=async()=>{};h.refreshViews=()=>{};h.refreshMarkdownAfterInlineAuthoring=()=>{};
 return {h,files,contents,parent};
}
const draft=()=>({description:'New',fieldValues:{parentTask:'p'},explicitFieldKeys:['parentTask'],tags:[],subtaskIds:[]});
test('drawing parent writes require the coordinated source adapter',async()=>{
 for(const format of ['inline','yaml']){
  const {h,files,parent}=setup();parent.primary.format=format;parent.primary.filePath='Parent.excalidraw.md';files.set(parent.primary.filePath,new TFile(parent.primary.filePath));
  h.app.vault.cachedRead=()=>assert.fail('uncoordinated drawing read');
  delete h.insertTaskCreatorInlineTaskInsideFileParent;delete h.insertTaskCreatorInlineTaskBelowInlineParent;
  const operation=format==='inline'?h.insertTaskCreatorInlineTaskBelowInlineParent(draft(),parent):h.insertTaskCreatorInlineTaskInsideFileParent(draft(),parent,'Backlog');
  await assert.rejects(operation,ExcalidrawSourceError);assert.equal(h.writes.length,0);
 }
});
test('paged picker draws 50, loads next 50, retains active state and keyboard visibility',()=>{
 const selected:any[]=[];showSearchableOptionPicker(new Element() as any,{value:null,options:Array.from({length:121},(_,i)=>({value:String(i),label:'File '+i})),placeholder:'Find',ariaLabel:'Files',noMatchesText:'Empty',pageSize:50,onSelect:v=>selected.push(v.value)});
 assert.equal(rows().length,50);const list=panel().querySelectorAll('.operon-searchable-option-picker-list')[0];list.scrollTop=901;list.fire('scroll');assert.equal(rows().length,100);assert.equal(rows()[0].classes.has('is-active'),true);assert.equal(rows()[0].attrs['aria-setsize'],'121');
 for(let i=0;i<105;i++)inputEl().fire('keydown',{key:'ArrowDown'});assert.equal(rows().length,121);assert.equal(rows()[105].classes.has('is-active'),true);inputEl().fire('keydown',{key:'Enter'});assert.deepEqual(selected,['105']);
});
test('fuzzy search covers unloaded items and preserves initial priority for tied scores',()=>{
 const opts=Array.from({length:200},(_,i)=>({value:String(i),label:i===199?'Needle':'Other '+i}));showSearchableOptionPicker(new Element() as any,{value:null,options:opts,placeholder:'',ariaLabel:'',noMatchesText:'Empty',pageSize:50,fuzzySearch:true,onSelect:()=>{}});
 inputEl().value='needle';inputEl().fire('input');assert.equal(rows().length,1);assert.equal(rows()[0].textContent,'Needle');
 assert.deepEqual(filterSearchableOptions(['x test','test first','test second'],'test',x=>x,true),['test first','test second','x test']);
 assert.equal(filterSearchableOptions(opts,'',x=>x.label).length,200);
});
test('default shared picker still renders all substring matches in supplied order',()=>{
 showSearchableOptionPicker(new Element() as any,{value:null,options:Array.from({length:70},(_,i)=>({value:String(i),label:'Abc '+i})),placeholder:'',ariaLabel:'',noMatchesText:'',onSelect:()=>{}});assert.equal(rows().length,70);inputEl().value='bc';inputEl().fire('input');assert.equal(rows().length,70);
});
test('target wrapper uses a bare picker with names only and preserves placement identity',async()=>{
 const promise=realPrompt([{reason:'active',target:{kind:'file',filePath:'A/Same.md',headingKeyword:'Tasks'}},{reason:'parent',target:{kind:'inline-parent',filePath:'A/Same.md',parentTaskId:'p'}}]);assert.equal(rows().length,2);assert.equal(rows()[0].textContent,'Same');assert.equal(rows()[1].textContent,'Same');assert.equal(rows()[0].querySelectorAll('.operon-searchable-option-picker-item-description').length,0);rows()[1].fire('click');assert.equal((await promise)?.kind,'inline-parent');
});
test('bare target picker Escape cancels without a modal and uses the active document host',async()=>{
 const pending=realPrompt([{reason:'active',target:{kind:'file',filePath:'Folder/A.md',headingKeyword:'Tasks'}}]);const options=(globalThis as any).floatingOptions;assert.equal(options.floatingHost,activeBody);assert.equal(options.anchor.width,0);assert.equal(options.matchWidth,360);assert.equal(options.closeOnWindowResize,false);assert.equal(options.repositionOnWindowResize,true);inputEl().fire('keydown',{key:'Escape'});assert.equal(await pending,null);
});
test('Ask Every Time precedes automatic parent routing; cancellation writes nothing',async()=>{
 const {h}=setup();const result=await h.insertTaskCreatorInlineTaskWithResolvedTarget(draft(),{activeFilePath:'Active.md'});assert.equal(result.kind,'cancelled');assert.deepEqual(h.writes,[]);assert.deepEqual(received.slice(0,2).map((x:any)=>x.reason),['active','parent']);assert.equal(h.records,0);
});
test('chosen file keeps selected parent; chosen parent uses its heading',async()=>{
 const {h}=setup();chosen={kind:'file',filePath:'Other.md',headingKeyword:'Tasks'};assert.equal((await h.createInlineTaskFromCreatorDraftResult(draft())).operonId,'new');assert.deepEqual(h.writes,[['file','Other.md','p']]);assert.equal(h.records,1);
 chosen={kind:'file-parent',filePath:'Parent.md',parentTaskId:'p',headingKeyword:'Backlog'};await h.insertTaskCreatorInlineTaskWithResolvedTarget(draft(),{});assert.deepEqual(h.writes[1],['parent','Parent.md','Backlog']);
});
test('ordinary save modes retain existing parent routing without picker',async()=>{
 const {h}=setup();h.resolveEffectiveInlineTaskSaveMode=()=> 'specific-file';await h.insertTaskCreatorInlineTaskWithResolvedTarget(draft(),{});assert.equal(received,null);assert.deepEqual(h.writes,[['parent','Parent.md','Backlog']]);
});
test('stale destination, deleted source parent and parent relocation reject without writes',async()=>{
 for(const mutation of ['file','parent','path']){const {h,files,contents,parent}=setup();chosen=()=>{if(mutation==='file')files.delete('Other.md');if(mutation==='parent')contents.set('Parent.md','plain note');if(mutation==='path')parent.primary.filePath='Other.md';return {kind:'file',filePath:'Other.md',headingKeyword:'Tasks'};};assert.equal((await h.insertTaskCreatorInlineTaskWithResolvedTarget(draft(),{})).kind,'failed');assert.equal(h.writes.length,0);assert.equal(h.records,0);}
});
test('inline parent selection inserts after its contiguous checkboxes with parent indentation',async()=>{
 const {h,contents,parent}=setup();parent.operonId='parent1';parent.primary.format='inline';h.indexer.getTask=(id:string)=>id==='parent1'?parent:null;
 h.settings.keyMappings=DEFAULT_SETTINGS.keyMappings;
 const original='  - [ ] Parent {{operonId:: parent1}}\\n- [ ] Own\\n    - [x] Nested\\n\\n- [ ] Unowned';contents.set('Parent.md',original);
 h.app.vault.cachedRead=h.app.vault.read;h.app.vault.modify=async(file:any,content:string)=>contents.set(file.path,content);
 h.buildTaskCreatorInlineTaskLine=()=>({operonId:'newtask',taskLine:'- [ ] Child {{operonId:: newtask}}',fieldValues:{}});h.validateDependencyDraftOrShow=()=>true;h.suppressRawTaskCreationNotice=()=>{};
 delete h.insertTaskCreatorInlineTaskBelowInlineParent;
 chosen={kind:'inline-parent',filePath:'Parent.md',parentTaskId:'parent1'};const d=draft();d.fieldValues.parentTask='parent1';const result=await h.insertTaskCreatorInlineTaskWithResolvedTarget(d,{});
 assert.equal(result.kind,'created');const lines=contents.get('Parent.md').split('\\n');assert.equal(lines[3],indentNewInlineSubtask(lines[0],'- [ ] Child {{operonId:: newtask}}'));assert.equal(lines[4],'');assert.equal(lines[5],'- [ ] Unowned');assert.equal(lines[2],'    - [x] Nested');
});
test('file parent selection applies its heading and creates missing heading at end',async()=>{
 for(const body of ['Introduction\\n','## Backlog\\nExisting text\\n']){const {h,contents}=setup();contents.set('Parent.md','---\\noperonId: p\\n---\\n'+body);h.app.vault.cachedRead=h.app.vault.read;h.app.vault.modify=async(file:any,content:string)=>contents.set(file.path,content);h.buildTaskCreatorInlineTaskLine=()=>({operonId:'newtask',taskLine:'- [ ] New',fieldValues:{}});h.validateDependencyDraftOrShow=()=>true;h.suppressRawTaskCreationNotice=()=>{};delete h.insertTaskCreatorInlineTaskInsideFileParent;chosen={kind:'file-parent',filePath:'Parent.md',parentTaskId:'p',headingKeyword:'Backlog'};assert.equal((await h.insertTaskCreatorInlineTaskWithResolvedTarget(draft(),{})).kind,'created');const after=contents.get('Parent.md');assert.equal(after.split('## Backlog').length,2);assert.ok(after.indexOf('- [ ] New')>after.indexOf('## Backlog'));}
});
test('cancelled UI creation does not record; history failure preserves successful task; duplicate saves counted once',async()=>{
 const {h}=setup();assert.equal(await h.createInlineTaskFromCreatorDraftResult(draft()),null);assert.equal(h.records,0);
 chosen={kind:'file',filePath:'Other.md',headingKeyword:'Tasks'};h.inlineTargetHistory.recordSuccess=async()=>{h.records++;throw Error('disk');};const old=console.error;console.error=()=>{};try {assert.equal((await h.createInlineTaskFromCreatorDraftResult(draft())).operonId,'new');await Promise.all([h.recordInlineTaskCreationTarget('new','Other.md'),h.recordInlineTaskCreationTarget('new','Other.md')]);}finally{console.error=old;}assert.equal(h.records,1);assert.deepEqual(notices,['inlineTargetHistorySaveFailed']);assert.equal(h.writes.length,1);
});
test('conversion can use target selection without recording history',async()=>{
 const {h}=setup();chosen={kind:'file',filePath:'Other.md',headingKeyword:'Tasks'};assert.equal((await h.createInlineTaskFromCreatorDraftResult(draft(),{recordTargetHistory:false})).operonId,'new');assert.equal(h.writes.length,1);assert.equal(h.records,0);
});
test('Calendar, Kanban and subtask wrappers count one successful manual creation each',async()=>{
 for(const kind of ['calendar','kanban','subtask']){const {h}=setup();chosen={kind:'file',filePath:'Other.md',headingKeyword:'Tasks'};h.getCreatedInlineTaskFilterDraft=()=>({});h.maybeNoticeCalendarCreatorFilterMismatch=()=>{};h.maybeNoticeKanbanCreatorFilterMismatch=()=>{};h.resolveKanbanSeedCheckbox=()=> 'open';h.prepareSubtaskCreation=async()=>true;h.notifySubtaskCreated=async()=>{};
 const ok=kind==='calendar'?await h.createCalendarInlineTaskFromCreatorDraft({}, {startDate:'2026-09-28'}, draft()):kind==='kanban'?await h.createKanbanInlineTaskFromCreatorDraft({}, {}, draft()):await h.createInlineSubtaskFromFlexibleCreatorDraft(draft());assert.equal(ok,true);assert.equal(h.records,1);assert.equal(h.writes.length,1);}
});
test('failed source creation does not record',async()=>{const {h}=setup();chosen={kind:'file',filePath:'Other.md',headingKeyword:'Tasks'};h.insertTaskCreatorInlineTaskIntoFile=async()=>{throw Error('source failure');};await assert.rejects(h.createInlineTaskFromCreatorDraftResult(draft()),/source failure/);assert.equal(h.records,0);});
test('editor history waits for captured view persistence and confirmed task identity',async()=>{
 const {h,contents}=setup();const view={file:{path:'Other.md'}};let saves=0;h.findInlineTaskLineIndex=(lines:any[])=>lines.includes('new')?0:-1;h.persistMarkdownViewBuffer=async(v:any)=>{assert.equal(v,view);saves++;contents.set('Other.md','new');};await h.recordInlineTaskCreationFromEditor(view,'new','Other.md');assert.equal(saves,1);assert.equal(h.records,1);
 const old=console.error;console.error=()=>{};try{h.persistMarkdownViewBuffer=async()=>{throw Error('save failed');};await h.recordInlineTaskCreationFromEditor(view,'second','Other.md');}finally{console.error=old;}assert.equal(h.records,1);
});
test('creator captures active file before focus changes and preserves snapshot on cancel',async()=>{
 const {h}=setup();h.storage={repeatSeries:{getAllSeriesIds:()=>[]}};h.getFileTaskTemplateOptionsForPicker=()=>[];h.getAvailableTaskCreatorDefaultFileTemplateId=()=>'';h.createInlineTaskFromCreatorDraft=async()=>false;
 h.openTaskCreator(draft(),{});const options=h.taskCreatorModal.options;h.getActiveMarkdownFile=()=>new TFile('Other.md');const snapshot=draft();await options.onSubmitInline(snapshot);assert.equal(h.inlineCreatorActiveFiles.get(snapshot),'Active.md');h.taskCreatorModal=null;options.onSubmitFailure(snapshot,'inline');const retry=h.taskCreatorModal.options;await retry.onSubmitInline(snapshot);assert.equal(h.inlineCreatorActiveFiles.get(snapshot),'Active.md');
});
`;
 const outfile = path.join(dir, 'test.cjs');
 await build({ stdin: { contents: input, loader:'ts', resolveDir:root }, outfile, bundle:true, platform:'node',format:'cjs',logLevel:'silent', plugins:[{name:'boundaries',setup(b){
  b.onResolve({filter:/^obsidian$/},()=>({path:stub}));
  b.onResolve({filter:/field-pickers\/common$|^\.\/common$/},()=>({path:'common',namespace:'test'}));
  b.onResolve({filter:/core\/i18n$|accessibility-label$|field-pickers\/list-picker$/},args=>({path:args.path,namespace:'test'}));
  b.onLoad({filter:/.*/,namespace:'test'},args=>({contents:args.path==='common'?`export const snapshotFloatingRectAnchor=()=>({x:0,y:0,width:0,height:0});export const createFloatingPanel=(anchor,_c,onClose,options)=>{globalThis.floatingOptions={anchor,...options};globalThis.panel=globalThis.makePanel();let closed=false;return {panel:globalThis.panel,close(){if(!closed){closed=true;onClose();}}};};export const requestFloatingInputFocus=()=>{};export const scrollChildIntoView=()=>{};`:args.path.endsWith('dom-compat')?`export const getOwnerWindow=()=>({requestAnimationFrame:cb=>cb()});`:args.path.endsWith('i18n')?`export const t=(_g,k)=>k;`:args.path.endsWith('list-picker')?`export const showSearchableMultiOptionPicker=()=>()=>{};`:`export const setAccessibleLabelWithoutTooltip=()=>{};`,loader:'js'}));
 }}]});
 const result=spawnSync(process.execPath,['--test',outfile],{stdio:'inherit'});
 if(result.status!==0)process.exitCode=1;
} finally {await rm(dir,{recursive:true,force:true});}
