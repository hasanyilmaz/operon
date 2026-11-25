import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import ts from 'typescript';
import {build} from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=fs.mkdtempSync(path.join(tmpdir(),'operon-embed-lifetime-'));
try {
 const source=fs.readFileSync(path.join(root,'src/ui/embed-filter-processor.ts'),'utf8');
 const ast=ts.createSourceFile('embed.ts',source,ts.ScriptTarget.Latest,true);
 const names=['createFilterSurfaceInstance','destroyFilterSurfaceInstance','destroyEmbedFilterInstance','parseFilterReference','resolveFilterSet','registerEmbedFilterProcessor','refreshEmbedFilters','renderEmbed','EmbedFilterRenderChild',
  'renderFilterSurface','renderHeader','attachEmbedLazyLoadSentinel','renderGroupedFilterTaskRows','getEmbedTreeScope','formatFilterTaskCount','copyFilterSetEmbedCode'];
 const declarations=names.map(name=>{const n=ast.statements.find(n=>n.name?.text===name);assert.ok(n,name);return n.getText(ast);});
 const prelude=`
 import {localWeekNumbering} from './src/core/periodic-note-path';
 import {applyEmbedDateOverrides,getEmbedDateField,parseEmbedDate} from './src/ui/embed-filter-dates';
 import {parseEmbedWidthPercent} from './src/ui/embed-percent-width';
 import {evaluateFilterSet as evaluateFlat,evaluateFilterSetGrouped as evaluateGrouped,getFilterSortSpecs,sortFilterTasks} from './src/core/filter-display';
 import {applyFilterSearch,isFilterSearchActive} from './src/systems/filter-search';
 import {getVisibleFilterTasks,getVisibleGroupedFilterResults} from './src/systems/filter-lazy-render';
 import {cloneFilterSet} from './src/types/settings';
 import {t} from './src/core/i18n';
 export class Element {
  children=[];attrs={};listeners={};cleaned=0;closed=0;widthCleaned=0;renders=0;
  constructor(options={}) {this.cls=typeof options==='string'?options:options.cls??'';this.attrs=options.attr??{};}
  cloneNode(){return new Element();}
  appendChild(el){this.children.push(el);return el;}
  createEl(_tag,options){return this.appendChild(new Element(options));}
  createDiv(options){return this.createEl('div',options);}
  createSpan(options){return this.createEl('span',options);}
  querySelector(selector){return this.children.find(el=>el.cls.split(' ').includes(selector.slice(1)))??this.children.map(el=>el.querySelector(selector)).find(Boolean)??null;}
  setAttribute(key,value){this.attrs[key]=value;}
  getAttribute(key){return this.attrs[key]??null;}
  addEventListener(event,listener){this.listeners[event]=listener;}
  empty(){this.children=[];}
  taskIds(){return this.children.flatMap(el=>el.taskId?[el.taskId]:el.taskIds());}
 }
 class MarkdownRenderChild{constructor(el){this.containerEl=el;}}
 const activeEmbeds=new Set(),FILTER_RENDER_BATCH_SIZE=50;
 let today='2026-11-18', generation=0;
 export const setToday=value=>{today=value;};
 const localToday=()=>today, getCurrentLang=()=> 'en';
 const registerFilterDayRefresh=(owner,callback)=>{owner.dayRefresh=callback;};
 const requestCloseTextFieldPopoversForOwner=el=>{el.closed++;},cleanupOperonRenderRoot=el=>{el.cleaned++;};
 const isSpecialDynamicFilterSet=()=>false;
 const bindEmbedPercentWidth=(el,width)=>{el.boundWidth=width;return ()=>{el.widthCleaned++;};},refreshActiveEmbedPercentWidths=()=>{};
 const renderError=(el,message)=>{el.error=message;};
 const noop=()=>{},getOwnerDocument=()=>({}),shouldResolveLocationCompactChips=()=>false;
 const identifyInlineTaskPart=noop, setIcon=noop, setAccessibleLabelWithoutTooltip=noop, bindOperonHoverTooltip=noop;
 const buildTaskWikilinkOverlaySettingsSignature=noop,buildTaskStatusIconRenderSettingsSignature=noop;
 const buildWorkflowStatusOrderSignature=noop,buildWorkflowStatusSemanticsSignature=noop,buildWorkflowStatusIdentityIndex=noop;
 const prepareTaskSortContext=noop,createProjectSerialScopeFilterResolver=noop;
 const getFilterGroupDisplayLabel=noop,renderGroupHeader=noop,runAsyncAction=noop,asyncHandler=noop;
 const getTableFilePropertyIndex=()=>({getSnapshot:(_tasks,indexGeneration)=>{generation=indexGeneration;return {signature:''};}});
 const evaluateFilterSet=(filter,tasks,priorities,pinned,pipelines,options)=>evaluateFlat(filter,tasks,priorities,pinned,pipelines,{...options,today});
 const evaluateFilterSetGrouped=(filter,tasks,priorities,pinned,pipelines,options)=>evaluateGrouped(filter,tasks,priorities,pinned,pipelines,{...options,today});
 const buildFilterTaskRowElement=task=>Object.assign(new Element(),{taskId:task.operonId});
 const reconcileFilterTaskSurface=(target,next)=>{target.children=next.children;target.rendered=generation;target.renders++;};
 class IntersectionObserver {
  constructor(callback){this.callback=callback;}
  observe(){}
  disconnect(){}
 }
 export const modalFilters=[];
 class FilterSetModal {constructor(_app,filter){modalFilters.push(filter);}open(){}}
 const createEmbeddedFilterSetModalQuickActions=noop;
 export const copied=[];
 const navigator={clipboard:{writeText:async text=>{copied.push(text);}}};
 class Notice {}
 `;
 const outfile=path.join(dir,'test.mjs');
 await build({stdin:{contents:prelude+declarations.join('\n')+'\nexport {copyFilterSetEmbedCode};',resolveDir:root,loader:'ts'},outfile,bundle:true,format:'esm',platform:'node',logLevel:'silent',alias:{obsidian:path.join(root,'scripts/test-support/obsidian.ts')}});
 const {registerEmbedFilterProcessor:register,refreshEmbedFilters:refresh,Element,setToday,modalFilters,copyFilterSetEmbedCode,copied}=await import(pathToFileURL(outfile).href);
 const group=(logic,children)=>({id:logic,logic,children});
 const condition=(field,operator,value,fieldType='date')=>({id:field,field,operator,fieldType,...(value===undefined?{}:{value})});
 const filter=(rootGroup=group('all',[]),options={})=>({id:'fs_test',name:'Test',rootGroup,conditions:[],matchLogic:rootGroup.logic,sorts:[],...options});
 const task=(operonId,fieldValues)=>({operonId,description:operonId,primary:{filePath:operonId+'.md',format:'inline',lineNumber:0},checkbox:'open',tags:[],fieldValues});
 const createHarness=(saved=filter(),tasks=[])=>{
  let generation=1, handler, writes=0;
  const settings={filterSets:[saved],keyMappings:[]};
  const write=()=>{writes++;};
  const deps={settings,getSettings:()=>settings,getPriorities:()=>[],getPipelines:()=>[],saveSettings:write,saveFilterSet:write,
   indexer:{getGeneration:()=>generation,getAllTasks:()=>tasks}};
  register((_lang,fn)=>{handler=fn;},deps);
  return {
   settings,
   get writes(){return writes;},
   update(){generation++;refresh(deps);},
   mount(block='filterId: fs_test',connected=true){
    let child;const el=new Element();el.isConnected=connected;
    handler(block,el,{addChild:value=>{child=value;child.onload();}});
    return {el,child,dispose(){child.onunload();}};
   },
  };
 };
 const setup=(connected=true)=>{const h=createHarness();return {...h.mount(undefined,connected),update:h.update};};
 let count=0;const test=(name,fn)=>{fn();count++;console.log('PASS',name);};
 test('initial detached section keeps receiving updates before attachment',()=>{
  const s=setup(false);s.update();assert.equal(s.el.rendered,2);assert.equal(s.el.cleaned,0);s.el.isConnected=true;assert.equal(s.el.rendered,2);s.dispose();
 });
 test('temporarily detached section returns with the latest rendered generation',()=>{
  const s=setup();s.el.isConnected=false;s.update();s.el.isConnected=true;assert.equal(s.el.rendered,2);assert.equal(s.el.widthCleaned,0);s.update();assert.equal(s.el.rendered,3);s.dispose();
 });
 test('temporary detach retains its owner and width binding until real unload',()=>{
  const s=setup();const instance=s.child.instance;s.el.isConnected=false;s.update();
  assert.equal(s.child.instance,instance);assert.equal(s.el.widthCleaned,0);
  let disconnected=0;instance.lazyLoadObserver={disconnect(){disconnected++;}};
  s.dispose();assert.equal(disconnected,1);assert.equal(s.el.widthCleaned,1);
 });
 for(const connected of [false,true])test('real child unload cleans and unregisters a '+(connected?'connected':'detached')+' section',()=>{
  const s=setup(connected);s.dispose();const before=s.el.renders;s.update();assert.equal(s.el.renders,before);assert.equal(s.el.cleaned,1);assert.equal(s.el.closed,1);assert.equal(s.el.widthCleaned,1);
 });
 test('repeated detach and reattach never duplicates the registered instance',()=>{
  const s=setup();for(let i=0;i<3;i++){s.el.isConnected=false;s.update();s.el.isConnected=true;s.update();}assert.equal(s.el.renders,7);s.dispose();
 });
 const requested='2026-11-11';
 const other='2026-11-12';
 const fields=['dateStarted','dateScheduled','dateDue','dateCompleted','dateCancelled','repeatOccurrenceDate'];
 for(const field of fields)test(field+' requires a matching date when no condition exists',()=>{
  const h=createHarness(filter(),[task('match',{[field]:requested}),task('other',{[field]:other}),task('missing',{})]);
  const embed=h.mount('filterId: "fs_test"\n'+field+': '+requested);
  assert.deepEqual(embed.el.taskIds(),['match']);
  embed.dispose();
 });
 test('all six block dates must match together',()=>{
  const matching=Object.fromEntries(fields.map(field=>[field,requested]));
  const h=createHarness(filter(),[task('match',matching),task('wrong',{...matching,dateDue:other})]);
  const embed=h.mount(['filter: "Test"','width: 130%',...fields.map(field=>field+': "'+requested+'"')].join('\n'));
  assert.deepEqual(embed.el.taskIds(),['match']);
  assert.equal(embed.el.boundWidth,130);
  embed.dispose();
 });
 test('override removes nested conflicting rules while retaining All, Any and None',()=>{
  const saved=filter(group('any',[
   group('none',[condition('dateScheduled','hasAnyValue')]),
   group('all',[
    condition('dateScheduled','isToday'),
    group('any',[condition('dateScheduled','after',other),condition('description','contains','allow','text')]),
    group('none',[condition('dateScheduled','dateIs',requested),condition('description','contains','reject','text')]),
   ]),
  ]));
  const tasks=['allow','allow-reject','skip','allow-wrong-day'].map(id=>task(id,{dateScheduled:id.endsWith('day')?other:requested}));
  for(const groupBy of [undefined,'dateScheduled']){
   const h=createHarness({...saved,groupBy},tasks);
   const embed=h.mount('filterId: fs_test\ndateScheduled: '+requested);
   assert.deepEqual(embed.el.taskIds(),['allow']);
   embed.dispose();
  }
 });
 test('legacy flat conditions and both saved recurrence fields are replaced',()=>{
  const saved=filter(undefined,{rootGroup:undefined,matchLogic:'any',conditions:[
   condition('repeatOccurrenceDate','dateIs',other),
   condition('taskOccurrenceDate','hasNoValue'),
  ]});
  const h=createHarness(saved,[task('correct',{repeatOccurrenceDate:requested}),task('wrong',{repeatOccurrenceDate:other}),task('no-occurrence',{dateScheduled:requested})]);
  const embed=h.mount('filterId: fs_test\nrepeatOccurrenceDate: '+requested);
  assert.deepEqual(embed.el.taskIds(),['correct']);
  embed.dispose();
 });
 test('invalid or duplicate dates stop only their own block',()=>{
  const h=createHarness(filter(),[task('leap',{dateStarted:'2024-02-29'})]);
  const good=h.mount("filterId: 'fs_test'\ndateStarted: '2024-02-29'");
  assert.deepEqual(good.el.taskIds(),['leap']);
  for(const invalid of ['2026-02-29','2026-11-31','2026-13-01','2026-11-11T09:00:00','"2026-11-11\'','']){
   const embed=h.mount('filterId: fs_test\ndateStarted: '+invalid);
   assert.match(embed.el.error,/dateStarted.*YYYY-MM-DD/);
   assert.equal(embed.child,undefined);
  }
  const duplicate=h.mount('filterId: fs_test\ndateStarted: 2024-02-29\nDATESTARTED: 2024-02-29');
  assert.match(duplicate.el.error,/dateStarted.*once/);
  assert.equal(duplicate.child,undefined);
  assert.deepEqual(good.el.taskIds(),['leap']);
  good.dispose();
 });
 test('each embed keeps its own date through search, pagination, refresh and day rollover',()=>{
  const saved=filter(group('all',[condition('dateScheduled','isToday'),condition('dateCompleted','isToday')]));
  const tasks=Array.from({length:52},(_,i)=>task('first-'+i,{dateScheduled:requested,dateCompleted:'2026-11-18'}));
  tasks.push(task('second',{dateScheduled:other,dateCompleted:'2026-11-18'}),
   task('plain',{dateScheduled:'2026-11-18',dateCompleted:'2026-11-18'}),
   task('first-tomorrow',{dateScheduled:requested,dateCompleted:'2026-11-19'}));
  const h=createHarness(saved,tasks), before=structuredClone(saved);
  const first=h.mount('filterId: fs_test\ndateScheduled: '+requested);
  const second=h.mount('filterId: fs_test\ndateScheduled: '+other);
  const plain=h.mount('filterId: fs_test\ndatetimeStart: ignored\ntrackedOn: ignored\ndate: ignored');
  assert.equal(first.el.taskIds().length,50);
  first.child.instance.lazyLoadObserver.callback([{isIntersecting:true}]);
  assert.equal(first.el.taskIds().length,52);
  const search=first.el.querySelector('.operon-filter-search-input');
  search.value='first-51';search.listeners.input();
  assert.deepEqual(first.el.taskIds(),['first-51']);
  h.update();
  assert.deepEqual(first.el.taskIds(),['first-51']);
  assert.deepEqual(second.el.taskIds(),['second']);
  assert.deepEqual(plain.el.taskIds(),['plain']);
  first.el.querySelector('.operon-embed-settings-btn').listeners.click();
  assert.deepEqual(modalFilters.at(-1),before);
  assert.deepEqual(saved,before);
  assert.equal(h.writes,0);
  setToday('2026-11-19');
  for(const embed of [first,second,plain])embed.child.dayRefresh();
  assert.deepEqual(first.el.taskIds(),[]);
  const daySearch=first.el.querySelector('.operon-filter-search-input');
  daySearch.value='';daySearch.listeners.input();
  assert.deepEqual(first.el.taskIds(),['first-tomorrow']);
  assert.deepEqual(second.el.taskIds(),[]);
  assert.deepEqual(plain.el.taskIds(),[]);
  first.dispose();
  setToday('2026-11-18');
  const edited=h.mount('filterId: fs_test');
  assert.deepEqual(edited.el.taskIds(),['plain']);
  h.settings.filterSets=[filter(group('all',[condition('dateScheduled','isToday')]))];
  h.update();
  assert.deepEqual(second.el.taskIds(),['second']);
  assert.equal(h.writes,0);
  for(const embed of [second,plain,edited])embed.dispose();
 });
 await copyFilterSetEmbedCode(filter());
 assert.deepEqual(copied,['```operon\nfilterId: "fs_test"\n```']);
 console.log(`Reading embed lifecycle: ${count}/${count} passed`);
} finally {fs.rmSync(dir,{recursive:true,force:true});}
