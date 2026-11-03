import { createTaskSourceActionButton } from '../src/ui/task-info-chip-action';
import { getNativePropertyIndex } from '../src/indexer/native-property-index';
import { bindTableTaskOpening, bindTablePropertyOpening, bindTableMarkdownOpening, resolveTableWikiOpening, readTablePropertyLinkValue } from '../src/ui/table/table-link-opening';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Platform, WorkspaceTabs, TFile, Notice } from 'obsidian';
import { readFileSync } from 'node:fs';
import { lightboxFixture } from './test-support/lightbox-dom';
import { pickerCalls } from './test-support/chip-opening-picker';
import { bindDesktopChipOpening, handleLinksChipClick, resolveChipOpening, isDesktopOpeningChip, activateResolvedOpening } from '../src/ui/links-chip-action';
import { buildInlineTaskCompactChipEntries } from '../src/ui/compact-task-layout';
import { bindTaskTextOpening } from '../src/ui/task-text-link-opening';
import { DEFAULT_SETTINGS } from '../src/types/settings';
import { bindCompactChipLinkPreview, bindTaskMediaChipPreview, cleanupTaskMediaChipPreviews } from '../src/ui/compact-chip-link-preview';
import { disposeWebLightboxes } from '../src/ui/web-lightbox';

const tick = () => new Promise(resolve => setImmediate(resolve));
const mouse = (extra:any = {}) => ({button:0, detail:1, metaKey:false, ctrlKey:false, preventDefault(){}, stopPropagation(){}, ...extra});
const entry = (key:string, rawValue?:string):any => ({key,rawValue,label:'Short label',icon:'link',iconOnly:false,interactive:true,colorRole:'default',linkTarget:null});
function fixture() {
 const f=lightboxFixture(), desktop=Platform.isDesktopApp, mac=Platform.isMacOS;
 Platform.isDesktopApp=true; Platform.isMacOS=true; pickerCalls.length=0;
 const files=new Map<string,any>(); for(const name of ['A.md','B.md','P.md','a.base','a.table','a.canvas','a.png','a.pdf']) files.set(name,new (TFile as any)(name));
 let task:any={operonId:'abcdefg', primary:{filePath:'A.md',format:'yaml',lineNumber:0},fieldValues:{},tags:[]};
 const parent:any={operonId:'hijklmn',primary:{filePath:'P.md',format:'yaml',lineNumber:0},fieldValues:{},tags:[]};
 let allowed=true, editable=true, writes=0, content='';
 const settings:any={...DEFAULT_SETTINGS,keyMappings:[...DEFAULT_SETTINGS.keyMappings,{canonicalKey:'customText',visiblePropertyName:'Custom Text',isSystem:false,type:'text',aliases:[]},{canonicalKey:'customList',visiblePropertyName:'Custom List',isSystem:false,type:'list',aliases:[]}]};
 const calls:any[] = [], notices:string[]=[], previews:any[]=[], external:any[]=[];
 f.doc.defaultView.open=(...args:any[])=>{external.push(args);return null;};
 (Notice as any).onNotice=(message:string)=>notices.push(message);
 const root=f.doc.body.createDiv();
 let viewType='empty';
 const group:any=new (WorkspaceTabs as any)({containerEl:f.doc.body} as any);
 const leaf:any={getViewState:()=>({pinned:false}),containerEl:root,view:{containerEl:root.createDiv(),getViewType:()=> viewType},async openFile(file:any,state:any){calls.push({file:file.path,state});viewType=file.extension==='base'?'bases':file.extension==='table'?'operon-table-file-view':file.extension==='md'?'markdown':file.extension;},async setViewState(state:any){viewType=state.type;calls.push(state.state.url);},async loadIfDeferred(){},detach(){calls.push('detach');}};
 const app:any={viewRegistry:{getTypeByExtension:(ext:string)=>ext==='canvas'?'canvas':null,getViewCreatorByType:()=>function(){}},vault:{getAbstractFileByPath:(path:string)=>files.get(path),read:async()=>content,getResourcePath:(file:any)=>'app:///'+file.path},
 metadataCache:{getFirstLinkpathDest:(path:string,source:string)=>files.get(path||source)},
 internalPlugins:{plugins:{bases:{enabled:true},'page-preview':{enabled:true},webviewer:{enabled:true,instance:{openUrl(url:string){calls.push(url);}}}},getEnabledPluginById:()=>({openUrl(url:string){calls.push(url);}})},
 workspace:{getMostRecentLeaf:()=>({...leaf,parent:group,view:{containerEl:f.anchor}}),createLeafInParent:(parent:any=group)=>{parent.insertChild?.(-1,leaf);return leaf;},setActiveLeaf(){},getLeaf:()=>leaf,async openLinkText(...args:any[]){calls.push(args);},trigger(name:string,payload:any){previews.push(payload);}}};
 const context:any={app,getSettings:()=>settings,getTask:()=>task,getTaskById:(id:string)=>id===parent.operonId?parent:id===task?.operonId?task:null,getAllTasks:()=>[task,parent].filter(Boolean),canActivate:()=>allowed,
 picker:()=>editable?{onCommit:()=>writes++}:null};
 const fire=(kind:string,event:any=mouse())=>(f.anchor as any).events.get(kind)?.(event);
 (f.anchor as any).click=()=>fire('click',mouse({detail:0}));
 return {...f,app,files,context,parent,settings,calls,notices,previews,external,fire,
  task:()=>task,removeTask(){task=null;},allowed(value:boolean){allowed=value;},editable(value:boolean){editable=value;},content(value:string){content=value;},writes:()=>writes,
  bind:(chipEntry:any)=>bindDesktopChipOpening(f.anchor,chipEntry,context),
  cleanup(){cleanupTaskMediaChipPreviews(f.anchor);disposeWebLightboxes(app);Platform.isDesktopApp=desktop;Platform.isMacOS=mac;(Notice as any).onNotice=null;}};
}
for(const key of ['taskType','customText','assignees','contexts','customList']) test(`${key}: full existing wiki only, original alias/subpath; plain/HTTP/missing use picker`,()=>{
 const f=fixture();try {
  for(const raw of ['[[B.md#Heading|Alias]]','plain','https://example.com','before [[B.md]]','[[missing]]']) {
   f.task().fieldValues[key]=raw;
   const d=resolveChipOpening(entry(key,raw),f.context);
   assert.equal(d.kind,raw.startsWith('[[B.md')?'target':'picker');
   if(d.kind==='target')assert.deepEqual(d.target,{kind:'local',linktext:'B.md#Heading',sourcePath:'A.md'});
  }
 }finally{f.cleanup();}
});
for(const key of ['assignees','contexts','customList','links','taskGallery']) test(`${key}: removed/reordered members never open a neighbour`,()=>{
 const f=fixture();try {
  const raw=key==='links'?'[Label](https://example.com)':'[[B.md]]', other=key==='links'?'https://other.example':'[[A.md]]';
  f.task().fieldValues[key]=`${other}; ${raw}`;
  const e=entry(key,raw);assert.equal(resolveChipOpening(e,f.context).kind,'target');
  f.task().fieldValues[key]=other;assert.equal(resolveChipOpening(e,f.context).kind,key==='taskGallery'?'missing':'picker');
 }finally{f.cleanup();}
});
test('media uses original targets; remote image stays media and missing local does not create',()=>{
 const f=fixture();try{
  for(const raw of ['[[a.png|Photo]]','https://example.com/image.png','[[missing]]']){
   f.task().fieldValues.taskImage=raw;const d=resolveChipOpening(entry('taskImage'),f.context);
   assert.equal(d.kind,raw==='[[missing]]'?'missing':'target');
   if(d.kind==='target'&&d.target.kind==='web')assert.equal(d.target.media?.kind,'image');
  }
  assert.equal(f.writes(),0);
 }finally{f.cleanup();}
});
test('scope excludes mobile, dependency chips and special picker types',()=>{
 const f=fixture();try{
  for(const key of ['status','priority','tags','blocking','blockedBy','taskInfo.projectSerial','note','location','dateDue'])assert.equal(isDesktopOpeningChip(key,f.settings),false,key);
  assert.equal(isDesktopOpeningChip('customText',f.settings),true);
  Platform.isDesktopApp=false;assert.equal(f.bind(entry('links')),false);assert.equal((f.anchor as any).events.size,0);
 }finally{f.cleanup();}
});
test('current Parent and Source use live file and line; unresolved Parent is picker, missing Source is notice',()=>{
 const f=fixture();try{
  f.task().fieldValues.parentTask=f.parent.operonId;
  assert.equal(resolveChipOpening(entry('parentTask'),f.context).kind,'target');
  f.parent.primary={format:'inline',filePath:'B.md',lineNumber:9};
  const d=resolveChipOpening(entry('parentTask'),f.context);assert.equal(d.kind,'target');if(d.kind==='target')assert.equal((d.target as any).line,9);
  f.task().fieldValues.parentTask='missing';assert.equal(resolveChipOpening(entry('parentTask'),f.context).kind,'picker');
  f.files.delete('A.md');assert.equal(resolveChipOpening(entry('taskInfo.source'),f.context).kind,'missing');
 }finally{f.cleanup();}
});
for(const extension of ['md','base','table','pdf','canvas'])test(`${extension}: modifier opens same original file once in owner document`,async()=>{
 const f=fixture();try{
  const path=extension==='md'?'B.md':`a.${extension}`;
  f.task().fieldValues.customText=`[[${path}]]`;
  // The supported native view must match its file type; media has no native type check.
  const leaf=f.app.workspace.getLeaf();leaf.view.getViewType=()=>extension==='base'?'bases':extension==='table'?'operon-table-file-view':extension==='canvas'?'canvas':'markdown';
  f.bind(entry('customText'));f.fire('click',mouse({metaKey:true}));f.fire('click',mouse({metaKey:true}));await tick();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].file,path);assert.equal(f.writes(),0);
 }finally{f.cleanup();}
});
test('canvas normal fallback uses native opening without creating files',async()=>{
 const f=fixture();try{f.task().fieldValues.customText='[[a.canvas]]';f.bind(entry('customText'));f.fire('click');await tick();assert.equal(f.calls[0]?.file,'a.canvas');}finally{f.cleanup();}
});
test('Icon Only keyboard, platform modifier, caret shield and double click produce one activation',async()=>{
 const f=fixture();try{
  f.task().fieldValues.links='https://example.com';const e=entry('links','https://example.com');e.iconOnly=true;f.bind(e);
  let prevented=0,stopped=0;f.fire('mousedown',mouse({preventDefault(){prevented++;},stopPropagation(){stopped++;}}));assert.equal(prevented,1);assert.equal(stopped,1);
  f.fire('click',mouse({metaKey:true}));await tick();assert.equal(f.calls.length,1);
  f.fire('click',mouse({metaKey:true,detail:2}));await tick();assert.equal(f.calls.length,1);
  Platform.isMacOS=false;f.fire('click',mouse({ctrlKey:true}));await tick();assert.equal(f.calls.length,2);
  assert.equal((f.anchor as any).attrs.role,'button');
  // A missing target exercises keyboard picker routing without creating a lightbox fixture.
  f.task().fieldValues.links='';f.fire('keydown',mouse({key:'Enter',repeat:false}));await tick();assert.equal(pickerCalls.length,1);assert.equal(f.writes(),0);
 }finally{f.cleanup();}
});
test('picker fallback keeps full current value, Save callback, Cancel and duplicate-open guard',async()=>{
 const f=fixture();try{
  f.task().fieldValues.customText='long original value';f.bind(entry('customText'));
  f.fire('click');await tick();f.fire('click');await tick();assert.equal(pickerCalls.length,1);
  assert.equal(pickerCalls[0].currentFieldValues.customText,'long original value');assert.equal(f.writes(),0);
  pickerCalls[0].onClose();f.fire('click');await tick();assert.equal(pickerCalls.length,2);
  pickerCalls[1].onCommit({customText:'new'});assert.equal(f.writes(),1);
 }finally{f.cleanup();}
});
test('read-only navigation works while picker fallback and drag-suppressed activation cannot mutate',async()=>{
 const f=fixture();try{
  f.editable(false);f.task().fieldValues.customText='plain';f.bind(entry('customText'));f.fire('click');await tick();assert.equal(pickerCalls.length,0);
  f.task().fieldValues.customText='[[a.canvas]]';f.fire('click');await tick();assert.equal(f.calls.length,1);
  f.allowed(false);f.fire('click');await tick();assert.equal(f.calls.length,1);assert.equal(f.writes(),0);
 }finally{f.cleanup();}
});
test('deleted task does not use retained chip snapshot',async()=>{
 const f=fixture();try{f.bind(entry('taskInfo.source'));f.removeTask();f.fire('click');await tick();assert.equal(f.calls.length,0);assert.deepEqual(f.notices,['Link target not found.']);}finally{f.cleanup();}
});
test('Source locates unique inline identity instead of stale line; no write on opening',async()=>{
 const f=fixture();try{
  f.task().primary.format='inline';f.task().primary.lineNumber=99;
  f.content('heading\n\n- [ ] Child {{operonId:: abcdefg}}');
  f.app.workspace.getLeaf().view.getViewType=()=> 'markdown';
  f.bind(entry('taskInfo.source'));f.fire('click',mouse({metaKey:true}));await tick();
  assert.deepEqual(f.calls[0]?.state.eState,{cursor:{from:{line:2,ch:11},to:{line:2,ch:11}},scroll:2,focus:true});assert.equal(f.writes(),0);
 }finally{f.cleanup();}
});
test('duplicate/missing inline identity and changed parent during read never open wrong line',async()=>{
 const f=fixture();try{
  f.parent.primary.format='inline';f.task().fieldValues.parentTask=f.parent.operonId;
  f.content('- [ ] P {{operonId:: hijklmn}}\n- [ ] P {{operonId:: hijklmn}}');
  f.bind(entry('parentTask'));f.fire('click',mouse({metaKey:true}));await tick();assert.equal(f.calls.length,0);assert.equal(pickerCalls.length,1);pickerCalls[0].onClose();
  let release:any;f.app.vault.read=()=>new Promise(resolve=>release=resolve);f.fire('click',mouse({metaKey:true}));f.task().fieldValues.parentTask='different';release('- [ ] P {{operonId:: hijklmn}}');await tick();assert.equal(f.calls.length,0);
 }finally{f.cleanup();}
});
test('modifier hover reads current wiki and plugin state, HTTP has no page preview',()=>{
 const f=fixture();try{
  f.task().fieldValues.customText='[[B.md]]';f.bind(entry('customText'));
  bindCompactChipLinkPreview(f.app,f.anchor,'stale.md','stale-source.md');
  f.fire('mouseover',mouse({metaKey:true}));assert.equal(f.previews.length,1);assert.equal(f.previews[0].linktext,'B.md');
  f.fire('mouseout');f.task().fieldValues.customText='[[A.md]]';f.fire('mouseover',mouse({metaKey:true}));assert.equal(f.previews[1].linktext,'A.md');
  f.fire('mouseout');f.app.internalPlugins.plugins['page-preview'].enabled=false;f.fire('mouseover',mouse({metaKey:true}));assert.equal(f.previews.length,2);
  f.fire('mouseout');f.app.internalPlugins.plugins['page-preview'].enabled=true;f.task().fieldValues.customText='https://example.com';f.fire('mouseover',mouse({metaKey:true}));assert.equal(f.previews.length,2);
 }finally{f.cleanup();}
});
test('local media owns one preview binding and modifier hover closes the small preview',()=>{
 const f=fixture();try{
  f.task().fieldValues.taskImage='[[a.png]]';f.bind(entry('taskImage'));
  bindTaskMediaChipPreview(f.app,f.anchor,{localLinkTarget:'stale.png',sourcePath:'stale.md'});
  f.fire('mouseenter',mouse({metaKey:true}));assert.equal(f.previews.length,1);assert.equal(f.previews[0].linktext,'a.png');
  f.fire('mousemove',mouse({metaKey:true}));assert.equal(f.previews.length,1);
 }finally{f.cleanup();}
});
test('builder carries list identity, supports Inline Parent and keeps mobile plain values passive',()=>{
 const f=fixture();try{
  f.task().fieldValues={assignees:'plain; [[B.md|Alias]]',customList:'[[A.md]]; [[B.md]]',parentTask:f.parent.operonId};f.parent.primary.format='inline';
  const items=['assignees','customList','parentTask'].map(key=>({key,visible:true,iconOnly:false}));
  const build=()=>buildInlineTaskCompactChipEntries(f.task().fieldValues,[],f.settings,[f.task(),f.parent],items as any);
  const entries=build();assert.equal(entries.find(item=>item.key==='assignees')?.rawValue,'plain');assert.equal(entries.find(item=>item.key==='parentTask')?.interactive,true);
  Platform.isDesktopApp=false;assert.equal(build().find(item=>item.key==='assignees')?.interactive,false);assert.equal(build().find(item=>item.key==='parentTask')?.interactive,false);
 }finally{f.cleanup();}
});
test('only approved chip renderers opt in; Table, Finder, Creator and Editor do not bind routing',()=>{
 for(const name of ['live-preview-conceal','reading-task-row','task-wikilink-overlay-chips','compact-card-chips'])assert.match(readFileSync(`src/ui/${name}.ts`,'utf8'),/bindDesktopChipOpening\(chip, entry/);
 for(const name of ['table/operon-table-view','task-finder-modal','task-editor-modal','task-creator-modal']){
  try{assert.doesNotMatch(readFileSync(`src/ui/${name}.ts`,'utf8'),/bindDesktopChipOpening/);}catch(error:any){if(error.code!=='ENOENT')throw error;}
 }
});

test('media full alias is resolved from the current value, not retained truncated label',()=>{
 const f=fixture();try{
  const label='A much longer and newly changed media alias';
  for(const raw of [`[[a.png|${label}]]`,`[${label}](https://example.com/image.png)`]){
   f.task().fieldValues.taskImage=raw;const d=resolveChipOpening({...entry('taskImage'),label:'old…',ariaLabel:'old full alias'},f.context);
   assert.equal(d.kind,'target');if(d.kind==='target')assert.equal(d.target.kind==='local'?d.target.label:d.target.media?.label,label);
  }
 }finally{f.cleanup();}
});
test('pinned native fallback creates a separate owner tab and keeps the pinned view',async()=>{
 const f=fixture();try{
  let replaced=0,created=0;
  f.app.workspace.getMostRecentLeaf=()=>({parent:{},getViewState:()=>({pinned:true}),view:{containerEl:f.anchor},openFile(){replaced++;}});
  const make=f.app.workspace.createLeafInParent;f.app.workspace.createLeafInParent=()=>{created++;return make();};
  f.task().fieldValues.customText='[[a.canvas]]';f.bind(entry('customText'));f.fire('click');await tick();assert.equal(replaced,0);assert.equal(created,1);assert.equal(f.calls[0]?.file,'a.canvas');
 }finally{f.cleanup();}
});

test('unregistered file extensions do not launch external apps or create empty tabs',async()=>{
 const f=fixture();try{
  f.files.set('a.zip',new (TFile as any)('a.zip'));f.task().fieldValues.customText='[[a.zip]]';f.bind(entry('customText'));
  f.fire('click');await tick();f.fire('click',mouse({metaKey:true}));await tick();assert.deepEqual(f.calls,[]);assert.equal(f.notices.length,2);
 }finally{f.cleanup();}
});
test('wrong-window native fallback disposes only its owned leaf without opening',async()=>{
 const f=fixture();try{
  const leaf=f.app.workspace.getLeaf();
  const parent=f.app.workspace.getMostRecentLeaf().parent;
  const mount=parent.recomputeChildrenDimensions.bind(parent);
  parent.recomputeChildrenDimensions=()=>{mount();leaf.view.containerEl.ownerDocument={};};
  f.task().fieldValues.customText='[[a.canvas]]';f.bind(entry('customText'));f.fire('click',mouse({metaKey:true}));await tick();assert.deepEqual(f.calls,['detach']);
 }finally{f.cleanup();}
});

test('native button keyboard shields the row while keeping one native activation',()=>{
 const f=fixture();try{
  (f.anchor as any).tagName='BUTTON';f.task().fieldValues.customText='plain';f.bind(entry('customText'));
  let prevented=0,stopped=0;
  for(const key of ['Enter',' ']) f.fire('keydown',mouse({key,repeat:false,preventDefault(){prevented++;},stopPropagation(){stopped++;}}));
  assert.equal(stopped,2);assert.equal(prevented,0);assert.equal(pickerCalls.length,0);
  f.fire('keydown',mouse({key:'Enter',repeat:true,preventDefault(){prevented++;}}));assert.equal(prevented,1);
 }finally{f.cleanup();}
});

function tableFixture() {
 const f = fixture(); let edits=0;
 const context = {...f.context,onPicker:()=>edits++};
 return {...f,context,edits:()=>edits,
  bindTable:(key:string, raw='')=>bindTableTaskOpening(f.anchor,key,raw,context)};
}
for(const key of ['links','taskImage','taskGallery','assignees','contexts','taskType','customText','customList','parentTask','source']) test(`Table ${key}: shared target, pointer shield, one modifier activation, no picker writes`,async()=>{
 const f=tableFixture();try{
  const raw=key==='links'?'[Label](https://example.com)':'[[B.md]]';
  f.task().fieldValues[key]=key==='parentTask'?f.parent.operonId:raw;
  f.app.workspace.getLeaf().view.getViewType=()=>key==='links'?'webviewer':'markdown';
  assert.equal(f.bindTable(key,raw),true);
  let stopped=0,prevented=0;
  f.fire('pointerdown',mouse({stopPropagation(){stopped++;},preventDefault(){prevented++;}}));
  assert.equal(stopped,1);assert.equal(prevented,1);
  f.fire('click',mouse({metaKey:true}));f.fire('click',mouse({metaKey:true,detail:2}));await tick();
  assert.equal(f.calls.length,1);assert.equal(f.edits(),0);assert.equal(f.writes(),0);
  assert.equal((f.anchor as any).dataset.operonTableLink,'true');
 }finally{f.cleanup();}
});
for(const key of ['taskType','customText','customList','assignees','contexts','parentTask']) test(`Table ${key}: missing/plain value invokes existing cell editor exactly once`,async()=>{
 const f=tableFixture();try{
  const raw='[[missing]]';f.task().fieldValues[key]=raw;f.bindTable(key,raw);
  f.fire('click');await tick();assert.equal(f.edits(),1);assert.equal(f.calls.length,0);
  f.fire('keydown',mouse({key:'Enter',repeat:true}));assert.equal(f.edits(),1);
  f.fire('keydown',mouse({key:' ',repeat:false}));await tick();assert.equal(f.edits(),2);assert.equal(f.writes(),0);
 }finally{f.cleanup();}
});
test('Table native property: exact complete string only; original alias/subpath, member change and typed values',async()=>{
 const f=tableFixture();try{
  let raw:unknown='[[B.md#Header|Alias]]';bindTablePropertyOpening(f.anchor,f.context,()=>raw);
  assert.deepEqual(resolveTableWikiOpening(f.context,raw),{kind:'target',target:{kind:'local',linktext:'B.md#Header',sourcePath:'A.md'}});
  for(const value of [42,null,undefined,'before [[B.md]]','https://example.com','[[missing]]']) {
   raw=value;f.fire('click');await tick();
  }
  assert.equal(f.edits(),6);assert.equal(f.calls.length,0);assert.equal(f.writes(),0);
 }finally{f.cleanup();}
});
for(const key of ['description','note'] as const)for(const kind of ['web','wiki'] as const)test(`Table ${key}/${kind}: opt-in text link, fresh content check and missing-file editor fallback`,async()=>{
 const f=tableFixture();try{
  const raw=kind==='web'?'[Label](https://example.com)':'[[B.md#Heading|Alias]]';
  const assign=(value:string)=>{if(key==='description')f.task().description=value;else f.task().fieldValues.note=value;};
  assign(raw);
  const link:any=kind==='web'?{type:'markdown-link',destination:'https://example.com',label:'Label',external:true}:{type:'wikilink',target:'B.md#Heading',label:'Alias'};
  bindTableMarkdownOpening(f.anchor,link,key,f.context);f.app.workspace.getLeaf().view.getViewType=()=>kind==='web'?'webviewer':'markdown';
  f.fire('click',mouse({metaKey:true}));await tick();assert.equal(f.calls.length,1);
  assign('link removed');f.fire('click');await tick();assert.equal(f.calls.length,1);assert.equal(f.edits(),1);
  if(kind==='wiki'){assign(raw);f.files.delete('B.md');f.fire('click');await tick();assert.equal(f.edits(),2);}
  assert.equal(f.writes(),0);
 }finally{f.cleanup();}
});
test('Table pending/readonly and mobile boundaries preserve navigation and mutation separation',async()=>{
 const f=tableFixture();try{
  f.task().fieldValues.customText='[[B.md]]';f.app.workspace.getLeaf().view.getViewType=()=> 'markdown';
  f.editable(false);f.bindTable('customText');f.allowed(false);f.fire('click',mouse({metaKey:true}));await tick();assert.equal(f.calls.length,0);
  f.allowed(true);f.fire('click',mouse({metaKey:true}));await tick();assert.equal(f.calls.length,1);assert.equal(f.writes(),0);
  Platform.isDesktopApp=false;
  assert.equal(f.bindTable('source'),false);assert.equal(bindTablePropertyOpening(f.anchor,f.context,()=> '[[B.md]]'),false);
  Platform.isDesktopApp=true;
  for(const key of ['projectSerial','sourcePath','file.name','blocking','blockedBy','priority','status','tags'])assert.equal(f.bindTable(key),false,key);
 }finally{f.cleanup();}
});
test('Table Source re-resolves inline line identity and rejects a removed task without a write',async()=>{
 const f=tableFixture();try{
  f.task().primary.format='inline';f.task().primary.lineNumber=999;
  f.content('header\n- [ ] task {{operonId:: abcdefg}}');f.app.workspace.getLeaf().view.getViewType=()=> 'markdown';
  f.bindTable('source');f.fire('click',mouse({metaKey:true}));await tick();assert.deepEqual(f.calls[0]?.state.eState.cursor,{from:{line:1,ch:10},to:{line:1,ch:10}});
  f.removeTask();f.fire('click');await tick();assert.equal(f.calls.length,1);assert.equal(f.writes(),0);
 }finally{f.cleanup();}
});

test('Table native property reads current shared index; type changes, removed members and source stamps cannot open old values',()=>{
 const f=tableFixture();try{
  const index=getNativePropertyIndex(f.app);index.configure(f.settings);index.setTypes({Native:'multitext',Text:'text'});
  const file=f.files.get('A.md');file.stat={mtime:1,size:100};
  const accept=(value:unknown)=>index.accept('A.md',{frontmatter:{operonId:'abcdefg',Native:value,Text:'[[B.md|Alias]]'},order:['operonId','Native','Text'],inline:[]});
  const field:any={propertyName:'Native',type:'list'};accept(['[[B.md]]',42,null]);
  assert.equal(readTablePropertyLinkValue(f.app,f.task(),field,'[[B.md]]'),'[[B.md]]');
  assert.equal(readTablePropertyLinkValue(f.app,f.task(),field,42),undefined);
  assert.equal(readTablePropertyLinkValue(f.app,f.task(),{propertyName:'Text',type:'text'} as any),'[[B.md|Alias]]');
  accept(['[[A.md]]']);assert.equal(readTablePropertyLinkValue(f.app,f.task(),field,'[[B.md]]'),undefined);
  index.setTypes({Native:'text'});assert.equal(readTablePropertyLinkValue(f.app,f.task(),field,'[[A.md]]'),undefined);
  index.setTypes({Native:'multitext'});file.stat.mtime=2;assert.equal(readTablePropertyLinkValue(f.app,f.task(),field,'[[A.md]]'),undefined);
  assert.equal(f.writes(),0);
 }finally{f.cleanup();}
});

for(const key of ['customList','assignees','contexts']) test(`Table ${key}: escaped semicolon member keeps its exact alias and target`,async()=>{
 const f=tableFixture();try {
  const raw='[[B.md|Semi; label]]';f.task().fieldValues[key]='[[B.md|Semi\\; label]]; plain';
  f.app.workspace.getLeaf().view.getViewType=()=> 'markdown';f.bindTable(key,raw);
  f.fire('click',mouse({metaKey:true}));await tick();assert.equal(f.calls[0]?.file,'B.md');assert.equal(f.edits(),0);
 }finally{f.cleanup();}
});

const middle = (extra:any = {}) => mouse({button:1,type:'auxclick',...extra});
for(const raw of ['https://example.com/work?id=42#comment','[Work item](http://example.com/work)'])for(const iconOnly of [false,true])test(`Links ${iconOnly?'icon':'detailed'} middle click uses the system browser and original URL: ${raw}`,async()=>{
 const f=fixture();try{
  f.task().fieldValues.links=raw;const e={...entry('links',raw),iconOnly};f.bind(e);
  f.app.internalPlugins.plugins.webviewer.enabled=false;f.app.internalPlugins.getEnabledPluginById=()=>null;
  let prevented=0,stopped=0;
  const event=middle({preventDefault(){prevented++;},stopPropagation(){stopped++;}});
  f.fire('auxclick',event);f.fire('auxclick',event);await tick();
  assert.equal(f.external.length,1);assert.deepEqual(f.external[0],[raw.startsWith('[')?'http://example.com/work':raw,'_external','noopener']);
  assert.equal(prevented,2);assert.equal(stopped,2);assert.deepEqual(f.calls,[]);assert.deepEqual(f.notices,[]);assert.equal(pickerCalls.length,0);assert.equal(f.writes(),0);
  f.fire('click',middle({type:'click'}));f.fire('auxclick',middle({detail:2}));f.fire('auxclick',middle({button:2}));await tick();
  assert.equal(f.external.length,1);
 }finally{f.cleanup();}
});
test('middle activation reads current membership and interaction permission without opening a picker',async()=>{
 const f=fixture();try{
  const raw='https://example.com/original';f.task().fieldValues.links=raw;f.bind(entry('links',raw));
  f.allowed(false);f.fire('auxclick',middle());await tick();assert.deepEqual(f.external,[]);
  f.allowed(true);f.task().fieldValues.links='https://example.com/replacement';f.fire('auxclick',middle());await tick();
  f.removeTask();f.fire('auxclick',middle());await tick();
  assert.deepEqual(f.external,[]);assert.deepEqual(f.calls,[]);assert.deepEqual(f.notices,[]);assert.equal(pickerCalls.length,0);assert.equal(f.writes(),0);
 }finally{f.cleanup();}
});
for(const key of ['taskImage','taskGallery','customText','parentTask','taskInfo.source'])test(`${key} remains outside external middle-click behavior`,async()=>{
 const f=fixture();try{
  const raw=key==='taskImage'||key==='taskGallery'?'https://example.com/remote':'[[B.md]]';
  f.task().fieldValues[key]=key==='parentTask'?f.parent.operonId:raw;f.bind(entry(key,raw));
  f.fire('auxclick',middle());await tick();assert.deepEqual(f.external,[]);assert.deepEqual(f.calls,[]);assert.deepEqual(f.notices,[]);assert.equal(pickerCalls.length,0);
 }finally{f.cleanup();}
});
for(const key of ['links','description','note'] as const)test(`Table ${key} middle click opens one current web target without editing`,async()=>{
 const f=tableFixture();try{
  const raw='[Site](https://example.com/table)';
  if(key==='links'){f.task().fieldValues.links=raw;f.bindTable('links',raw);}
  else {
   if(key==='description')f.task().description=raw;else f.task().fieldValues.note=raw;
   bindTableMarkdownOpening(f.anchor,{type:'markdown-link',destination:'https://example.com/table',label:'Site',external:true},key,f.context);
  }
  let prevented=0;f.fire('pointerdown',middle({preventDefault(){prevented++;}}));assert.equal(prevented,1);
  f.fire('auxclick',middle({metaKey:true,ctrlKey:true}));await tick();
  assert.deepEqual(f.external,[['https://example.com/table','_external','noopener']]);assert.deepEqual(f.calls,[]);assert.equal(f.edits(),0);assert.equal(f.writes(),0);
  if(key==='description')f.task().description='removed';else f.task().fieldValues[key]='removed';
  f.fire('auxclick',middle());await tick();assert.equal(f.external.length,1);assert.equal(f.edits(),0);
 }finally{f.cleanup();}
});
test('rendered task text uses current content for middle click; normal modifier still opens an Obsidian tab',async()=>{
 const f=fixture();try{
  let value='[Site](https://example.com/text)';
  bindTaskTextOpening(f.app,()=>({value,sourcePath:'A.md'}))!(f.anchor,{type:'markdown-link',destination:'https://example.com/text',label:'Site',external:true});
  f.fire('auxclick',middle());await tick();assert.deepEqual(f.external,[['https://example.com/text','_external','noopener']]);
  f.app.workspace.getLeaf().view.getViewType=()=> 'webviewer';f.fire('click',mouse({metaKey:true}));await tick();assert.deepEqual(f.calls,['https://example.com/text']);
  value='removed';f.fire('auxclick',middle());await tick();assert.equal(f.external.length,1);assert.equal(f.writes(),0);
 }finally{f.cleanup();}
});
test('legacy Table Links opening shares the explicit external mode without changing modifier routing',async()=>{
 const f=fixture();try{
  handleLinksChipClick(f.app,f.anchor,{key:'links',externalUrl:'https://example.com/legacy'},middle());await tick();
  assert.deepEqual(f.external,[['https://example.com/legacy','_external','noopener']]);assert.deepEqual(f.calls,[]);
 }finally{f.cleanup();}
});

test('context menu Source activation retains missing-file and ambiguous-inline protections',async()=>{
 const f=fixture();try{
  const context={...f.context,resolve:()=>resolveChipOpening(entry('taskInfo.source'),f.context)};
  f.files.delete('A.md');await activateResolvedOpening(f.anchor,context);
  assert.equal(f.calls.length,0);assert.deepEqual(f.notices,['Link target not found.']);
  f.files.set('A.md',new (TFile as any)('A.md'));f.task().primary.format='inline';
  f.content('- [ ] One {{operonId:: abcdefg}}\n- [ ] Two {{operonId:: abcdefg}}');
  await activateResolvedOpening(f.anchor,context);assert.equal(f.calls.length,0);assert.equal(f.writes(),0);
 }finally{f.cleanup();await tick();}
});

function sourceActionFixture() {
 const f=fixture();
 f.doc.win.createEl=(tag:string)=>f.doc.body.createEl(tag);
 const button=createTaskSourceActionButton({app:f.app,owner:f.anchor,getSettings:f.context.getSettings,getTask:f.context.getTask,taskColor:null,className:'operon-live-preview-action',canActivate:()=>f.context.canActivate()});
 return {...f,button,fireSource:(kind:string,event:any=mouse())=>(button as any).events.get(kind)?.(event)};
}
for(const mac of [true,false])test(`Source action ${mac?'Cmd':'Ctrl'} opens the fresh File and Inline target once without writes`,async()=>{
 const f=sourceActionFixture();try{
  Platform.isMacOS=mac;f.task().primary={filePath:'B.md',format:'inline',lineNumber:99};f.content('heading\n- [ ] Child {{operonId:: abcdefg}}');
  const event=mouse(mac?{metaKey:true}:{ctrlKey:true});f.fireSource('click',event);f.fireSource('click',event);await tick();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].file,'B.md');assert.deepEqual(f.calls[0].state.eState.cursor,{from:{line:1,ch:11},to:{line:1,ch:11}});assert.equal(f.writes(),0);
  assert.equal(f.button.tagName,'BUTTON');assert.match(f.button.className,/operon-task-source-action/);assert.equal(f.button.getAttribute('title')!==null,false);
 }finally{f.cleanup();}
});
test('Source action pointer and keyboard preserve editing, native activation and missing-target no-write guards',async()=>{
 const f=sourceActionFixture();try{
  let prevented=0,stopped=0;f.fireSource('pointerdown',mouse({preventDefault(){prevented++;},stopPropagation(){stopped++;}}));assert.equal(prevented,1);assert.equal(stopped,1);
  f.fireSource('keydown',mouse({key:'Enter',repeat:false,preventDefault(){prevented++;},stopPropagation(){stopped++;}}));assert.equal(prevented,1);assert.equal(f.calls.length,0);
  f.fireSource('keydown',mouse({key:' ',repeat:true,preventDefault(){prevented++;},stopPropagation(){stopped++;}}));assert.equal(prevented,2);
  f.files.delete('A.md');f.fireSource('click');await tick();assert.deepEqual(f.notices,['Link target not found.']);assert.equal(f.calls.length,0);
  f.allowed(false);f.fireSource('click');await tick();assert.equal(f.notices.length,1);assert.equal(f.writes(),0);
 }finally{f.cleanup();}
});
