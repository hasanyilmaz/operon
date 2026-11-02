import { nativeFixture } from './test-support/kanban-native-fixture';
import { App } from 'obsidian';
import { getNativePropertyIndex } from '../src/indexer/native-property-index';
import { KanbanView } from '../src/ui/kanban/kanban-view';
import { kanbanAxisReason } from '../src/ui/kanban/kanban-axis-labels';
import { t } from '../src/core/i18n';
import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { DEFAULT_SETTINGS, migrateSettings, type KeyMapping } from '../src/types/settings';
import { cloneDefaultKanbanPresets } from '../src/types/kanban';
import { createKanbanPropertyAccess } from '../src/core/kanban-axis-properties';
import { queryKanbanAxisBoard, projectKanbanStatusIcon, getKanbanAutoCollapse, kanbanTaskMatchesCell, type KanbanBoardData } from '../src/systems/kanban-board';
import { normalizeKanbanAxisLeafState, preserveKanbanOrderForAxisEdit } from '../src/systems/kanban-axis-state';
import { buildKanbanGroupingCellKey } from '../src/systems/kanban-grouping';
import type { KanbanAxis, KanbanAxisValue, KanbanPropertyReference } from '../src/core/kanban-axis-model';
import type { IndexedTask } from '../src/types/fields';
import { buildKanbanVirtualAxis, getKanbanVirtualRange } from '../src/systems/kanban-virtual-geometry';

const value=(value:string|number|boolean):KanbanAxisValue=>({kind:'value',value});
test('unrecognized task taxonomy values do not claim the preset configuration is unavailable',()=>{
 for(const reason of ['unresolved-status','unresolved-priority']){
  assert.equal(kanbanAxisReason(reason),t('notifications','kanbanAxisUnresolvedValue'));
  assert.notEqual(kanbanAxisReason(reason),t('notifications','kanbanAxesUnavailable'));
 }
});
const axis=(key:string,type:KanbanPropertyReference['type']='text',values:KanbanAxisValue[]=[]):KanbanAxis=>({kind:'property',property:{source:'managed',key,type},values});
const task=(id:string,fieldValues:Record<string,string>={},tags:string[]=[]):IndexedTask=>({operonId:id,description:id,fieldValues,tags,checkbox:'open',tier:'hot',datetimeModified:'',primary:{filePath:`${id}.md`,format:'inline',lineNumber:0}});
function fixture(columns:KanbanAxis,swimlanes:KanbanAxis|null,tasks:IndexedTask[]=[]){
	const settings=migrateSettings(structuredClone(DEFAULT_SETTINGS)),preset=cloneDefaultKanbanPresets()[0];
	preset.axes={version:1,columns,swimlanes};preset.collapseEmptyColumns=false;preset.collapseEmptySwimlanes=false;
	const native={getTypes:()=>({}),getRevision:()=>1,isReady:()=>true,getTask:()=>({available:true,revision:'1',properties:new Map()})};
	const options={preset,settings,tasks,propertyAccess:createKanbanPropertyAccess(settings,native),revision:{tasks:1,settings:1}};
	return {settings,preset,native,options,refresh(){options.propertyAccess=createKanbanPropertyAccess(settings,native);}};
}
function board(options:Parameters<typeof queryKanbanAxisBoard>[0]):KanbanBoardData{const b=queryKanbanAxisBoard(options);if('state'in b)throw Error(b.reason);return b;}
for(const type of ['text','number','date','datetime','checkbox','list'] as const) test(`renderer data and typed actions: ${type} in either direction`,()=>{
	const sample={text:'A',number:'5',date:'2026-10-27',datetime:'2026-10-27T14:30',checkbox:'false',list:'book; action'}[type];
	const f=fixture(axis('Custom',type),axis('Custom',type),[task('a',{Custom:sample})]);
	f.settings.keyMappings.push({canonicalKey:'Custom',visiblePropertyName:'Custom',type,isSystem:false,showInKanbanSwimlane:false} as KeyMapping);f.refresh();
	const b=board(f.options);assert.equal(b.snapshot.total,1);
	for(const c of b.columns)for(const r of b.lanes){assert.equal(b.getCellCount(c.statusId,r.key),1);assert.deepEqual(b.getCellTasks(c.statusId,r.key).map(t=>t.operonId),['a']);assert.notEqual(b.getActionPlan(c.statusId,r.key).state,'blocked');}
});
test('same scalar conflicts stay visible but all actions reject them',()=>{
	const f=fixture(axis('estimate','number',[value(1)]),axis('estimate','number',[value(5)]),[task('a',{estimate:'1'})]);const b=board(f.options),c=b.columns[0],r=b.lanes[0];
	assert.equal(b.getCellCount(c.statusId,r.key),0);
	assert.equal(b.getActionPlan(c.statusId,r.key).state,'blocked');assert.equal(b.getActionPlan(c.statusId,r.key,f.options.tasks[0]).state,'blocked');
});
test('list overlay retains source, target, unique totals and applies each native identity once',()=>{
	const f=fixture(axis('tags','list',[value('book'),value('action')]),axis('assignees','list',[value('Ada'),value('Ben')]),[task('one',{assignees:'Ada'},['book'])]);const b=board(f.options);
	const source=b.getTarget(b.columns[0].statusId,b.lanes[0].key)!,target=b.getTarget(b.columns[1].statusId,b.lanes[1].key)!;
	const plan=b.getActionPlan(b.columns[1].statusId,b.lanes[1].key,f.options.tasks[0]);assert.notEqual(plan.state,'blocked');if(plan.state==='blocked')return;
	assert.equal(kanbanTaskMatchesCell(b.axes,source,f.options.tasks[0],f.options.propertyAccess,plan),true);
	assert.equal(kanbanTaskMatchesCell(b.axes,target,f.options.tasks[0],f.options.propertyAccess,plan),true);
	const next=board({...f.options,overlays:[{taskId:'one',plan}]});assert.equal(next.snapshot.total,1);
	for(const c of next.columns)for(const r of next.lanes)assert.deepEqual(next.getCellTasks(c.statusId,r.key).map(t=>t.operonId),['one']);
	assert.deepEqual(f.options.tasks[0].tags,['book']);
});
test('manual cells append new tasks using general sorting and no input order is rewritten',()=>{
	const f=fixture(axis('tags','list'),null,[task('z',{},['a']),task('a',{},['a']),task('m',{},['a'])]);f.preset.sortMode='manual';f.preset.sortRules=[{field:'description',direction:'asc',empty:'last'}];
	const b=board(f.options),c=b.columns[0].statusId,r=b.lanes[0].key;const order={[buildKanbanGroupingCellKey(c,r)]:['m']};
	assert.deepEqual(b.getCellTasks(c,r).map(t=>t.operonId),['a','m','z']);
	assert.deepEqual(board({...f.options,manualOrder:order}).getCellTasks(c,r).map(t=>t.operonId),['m','a','z']);assert.deepEqual(Object.values(order),[['m']]);
});
test('status rows collapse finished groups and preserve scoped collapse independently of axes',()=>{
	const f=fixture(axis('tags','list',[value('x')]),null);const pipeline=f.settings.pipelines[0];f.preset.axes={version:1,columns:axis('tags','list',[value('x')]),swimlanes:{kind:'status',pipelineId:pipeline.id}};f.preset.autoCollapseFinishedColumns=true;
	const b=board(f.options);const auto=getKanbanAutoCollapse(b);assert.equal(auto.columns.size,0);assert.equal(auto.rows.size,pipeline.statuses.filter(s=>s.isFinished).length);
	f.settings.kanbanPresets=[f.preset];f.settings.kanbanDefaultPresetId=f.preset.id;
	const state=normalizeKanbanAxisLeafState({presetId:f.preset.id},f.settings,f.options.propertyAccess);const scope=Object.keys(state.collapsedStatusIdsByScope)[0];state.collapsedStatusIdsByScope[scope]=[b.columns[0].statusId];
	assert.deepEqual(normalizeKanbanAxisLeafState(state,f.settings,f.options.propertyAccess).collapsedStatusIds,[b.columns[0].statusId]);
	f.preset.axes={version:1,columns:axis('estimate','number'),swimlanes:null};assert.deepEqual(normalizeKanbanAxisLeafState(state,f.settings,f.options.propertyAccess).collapsedStatusIds,[]);
});
test('legacy order binds to its old typed axes before an edit and does not leak to another property',()=>{
	const f=fixture(axis('tags','list'),null);const pipeline=f.settings.pipelines[0],status=pipeline.statuses[0];delete f.preset.axes;f.preset.pipelineId=pipeline.id;f.preset.swimlaneBy='tags';
	f.options.tasks=[task('one',{status:`${pipeline.name}.${status.label}`},['book'])];
	const original={[`${status.id}::book`]:['one']};const converted=preserveKanbanOrderForAxisEdit(f.preset,original,f.settings,f.options.propertyAccess);const b=board({...f.options,manualOrder:converted});
	assert.ok(converted[buildKanbanGroupingCellKey(b.columns[0].statusId,b.lanes[0].key)]);assert.deepEqual(original,{[`${status.id}::book`]:['one']});
	assert.ok(Object.keys(converted).some(k=>k.startsWith('["legacy-order"')));
});
test('partial snapshots keep explicit empty groups expanded and do not count pending values as empty',()=>{
	const f=fixture({kind:'property',property:{source:'native',key:'Native',type:'number'},values:[{kind:'empty'},value(5)]},null,[task('one')]);
	const native={...f.native,getTypes:()=>({Native:'number' as const}),isReady:()=>false};f.options.propertyAccess=createKanbanPropertyAccess(f.settings,native);f.preset.collapseEmptyColumns=true;
	const b=board(f.options);assert.equal(b.snapshot.state,'partial');assert.equal(b.snapshot.total,0);assert.equal(getKanbanAutoCollapse(b).columns.size,0);
});
test('10000 tasks, 200 × 300 headers: viewport queries do not reread properties or build a cell matrix',()=>{
	const tasks=Array.from({length:10000},(_,i)=>task(String(i),{assignees:`r${i%200}`},[`c${i%300}`,`c${(i+1)%300}`]));
	const f=fixture(axis('tags','list'),axis('assignees','list'),tasks);let reads=0;const access=f.options.propertyAccess;f.options.propertyAccess={...access,read(...args){reads++;return access.read(...args);}};
	const start=performance.now(),b=board(f.options),built=performance.now();assert.equal(reads,20000);assert.equal(b.columns.length,300);assert.equal(b.lanes.length,200);assert.equal('cellMap'in b,false);
	const x=buildKanbanVirtualAxis(b.columns.map(c=>({key:c.statusId,size:320})),10),y=buildKanbanVirtualAxis(b.lanes.map(r=>({key:r.key,size:450})),10);let queried=0,max=0;
	for(const [left,top]of [[0,0],[7000,16000],[98000,90000],[0,0]]){const cols=getKanbanVirtualRange(x,left,1100),rows=getKanbanVirtualRange(y,top,800);let count=0;for(let r=rows.start;r<rows.end;r++)for(let c=cols.start;c<cols.end;c++){b.getCellTasks(b.columns[c].statusId,b.lanes[r].key);queried++;count++;}max=Math.max(max,count);}
	assert.ok(max<=30);assert.equal(reads,20000);assert.ok(queried<120);console.log(JSON.stringify({tasks:10000,headers:'200x300',propertyReads:reads,queriedCells:queried,maxWindow:max,buildMs:built-start,queryMs:performance.now()-built}));
});

test('legacy collapse is bound once and malformed records cannot stop the board',()=>{
	const f=fixture(axis('priority'),null);delete f.preset.axes;f.preset.pipelineId=f.settings.pipelines[0].id;f.preset.swimlaneBy='priority';f.settings.kanbanPresets=[f.preset];f.settings.kanbanDefaultPresetId=f.preset.id;
	const state=normalizeKanbanAxisLeafState({presetId:f.preset.id,collapsedLaneKeysByPreset:{[f.preset.id]:['S']}},f.settings,f.options.propertyAccess);
	assert.equal(state.collapsedLaneKeys.length,1);f.preset.swimlaneBy='tags';
	assert.deepEqual(normalizeKanbanAxisLeafState(state,f.settings,f.options.propertyAccess).collapsedLaneKeys,[]);
	for(const damaged of [42,[7],null])assert.doesNotThrow(()=>normalizeKanbanAxisLeafState({presetId:f.preset.id,collapsedLaneKeysByPreset:{[f.preset.id]:damaged}} as never,f.settings,f.options.propertyAccess));
});

test('native file and inline cells use their own values and typed action drafts without source rereads',async()=>{
 const f=await nativeFixture(),preset=cloneDefaultKanbanPresets()[0];
 const nativeAxis=(key:string,type:'number'|'checkbox'):KanbanAxis=>({kind:'property',property:{source:'native',key,type},values:[]});
 preset.axes={version:1,columns:nativeAxis('Effort','number'),swimlanes:nativeAxis('Flag','checkbox')};
 const before=f.reads(),b=board({preset,settings:f.s,tasks:f.tasks,propertyAccess:createKanbanPropertyAccess(f.s,f.native),revision:{tasks:1,settings:1}});
 assert.deepEqual(b.columns.map(c=>c.statusLabel),['0','5','20']); assert.equal(b.snapshot.total,3);
 const falseRow=b.lanes.find(r=>r.axisValue?.kind==='value'&&r.axisValue.value===false)!;
 const emptyRow=b.lanes.find(r=>r.axisValue?.kind==='empty')!;
 assert.deepEqual(b.getCellTasks(b.columns[0].statusId,falseRow.key).map(t=>t.operonId),['file001']);
 assert.deepEqual(b.getCellTasks(b.columns[1].statusId,falseRow.key).map(t=>t.operonId),['line001']);
 const file=b.getActionPlan(b.columns[1].statusId,emptyRow.key,f.tasks.find(t=>t.operonId==='file001'));
 assert.equal(file.state,'ready');assert.equal(file.filePropertyDraft.changes.length,2);assert.equal(file.inlinePropertyDraft.length,0);
 const inline=b.getActionPlan(b.columns[2].statusId,falseRow.key,f.tasks.find(t=>t.operonId==='line001'));
 assert.equal(inline.state,'ready');assert.equal(inline.inlinePropertyDraft.find(c=>c.sourceName==='Effort')?.expected.rawValue,'5');assert.equal(inline.filePropertyDraft.changes.length,0);
 assert.equal(f.reads(),before);f.native.dispose();
});
test('status icon projection updates completion-date axes using the existing cell consequences',()=>{
 const f=fixture(axis('dateCompleted','date'),null);f.settings.taskIconClickAction='state';
 const pipeline=f.settings.pipelines[0],open=pipeline.statuses.find(s=>!s.isFinished&&!s.isCancelled)!;
 const original=task('one',{status:`${pipeline.name}.${open.label}`});
 const next=projectKanbanStatusIcon(original,f.settings,f.options.propertyAccess)!;
 assert.equal(next.checkbox,'done');assert.match(next.fieldValues.dateCompleted,/^\d{4}-\d{2}-\d{2}$/);assert.equal(original.fieldValues.dateCompleted,undefined);
 const b=board({...f.options,tasks:[original],overlays:[{taskId:'one',nextTask:next}]});
 assert.equal(b.columns[0].statusLabel,next.fieldValues.dateCompleted);assert.equal(b.getCellCount(b.columns[0].statusId,b.lanes[0].key),1);
});

test('native preparation is shared per scope and stale completions cannot refresh another view',async()=>{
 const f=fixture({kind:'property',property:{source:'native',key:'Native',type:'number'},values:[value(1)]},null,[task('one')]);
 const app=new App(),native=getNativePropertyIndex(app);native.setTypes({Native:'number'});
 let calls=0,refreshes=0;const releases:Array<()=>void>=[];
 native.isReady=()=>false;native.ensure=async()=>{calls++;await new Promise<void>(resolve=>releases.push(resolve));};
 const owner={app,indexer:{getAllTasks:()=>f.options.tasks,getGeneration:()=>1,getTask:()=>f.options.tasks[0]},getSettings:()=>f.settings,
  getActiveSearchQuery:()=>'',resolveKanbanSearchTaskIdFilter:()=>undefined,hasKanbanSearchScopeFilters:()=>false,getFilePropertyContext:()=>undefined,getPinnedCache:()=>null,
  callbacks:{},optimisticMoves:new Map(),nativeLifetime:0,nativePreparation:null,containerEl:{isConnected:true},markDirty:()=>{refreshes++;}};
 const query=()=> (KanbanView.prototype as any).queryKanbanBoardData.call(owner,{searchQuery:''},f.preset,null,null,f.settings,null);
 try {
  assert.equal(query().board.snapshot.state,'partial');query();assert.equal(calls,1);
  owner.nativeLifetime++;f.preset.id='second-preset';query();assert.equal(calls,2);
  releases[0]();await Promise.resolve();await Promise.resolve();assert.equal(refreshes,0);
  releases[1]();await Promise.resolve();await Promise.resolve();assert.equal(refreshes,1);
 } finally {native.dispose();}
});
