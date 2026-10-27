import { TFile, type App } from 'obsidian';
import { scanFileWithMappings } from '../src/indexer/file-scanner';
import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { DEFAULT_SETTINGS, migrateSettings, type FilterSet, type KeyMapping } from '../src/types/settings';
import { cloneDefaultKanbanPresets } from '../src/types/kanban';
import { createKanbanPropertyAccess } from '../src/core/kanban-axis-properties';
import type { KanbanAxis, KanbanAxisValue, KanbanPropertyReference } from '../src/core/kanban-axis-model';
import { buildKanbanGroupingSnapshot, buildKanbanGroupingCellKey, type KanbanGroupingOptions, type KanbanGroupingSnapshot } from '../src/systems/kanban-grouping';
import { queryKanbanBoard, buildKanbanCellKey } from '../src/systems/kanban-query';
import type { IndexedTask } from '../src/types/fields';
import { NativePropertyIndex } from '../src/indexer/native-property-index';
import { getTimeScopedFieldValues } from '../src/core/time-scope-values';

const settings = () => migrateSettings(structuredClone(DEFAULT_SETTINGS));
const ref = (key: string, type: KanbanPropertyReference['type'] = 'text', source: 'managed' | 'native' = 'managed'): KanbanPropertyReference => ({key,type,source});
const value = (value: string|number|boolean): KanbanAxisValue => ({kind:'value',value});
const axis = (key: string, type: KanbanPropertyReference['type'] = 'text', values: KanbanAxisValue[] = [], source: 'managed'|'native' = 'managed'): KanbanAxis => ({kind:'property',property:ref(key,type,source),values});
const task = (id: string, fields: Record<string,string> = {}, tags: string[] = []): IndexedTask => ({operonId:id,description:id,fieldValues:fields,tags,checkbox:'open',tier:'hot',datetimeModified:'',primary:{filePath:`${id}.md`,format:'inline',lineNumber:0}});
const custom = (key: string,type: KeyMapping['type']): KeyMapping => ({canonicalKey:key,visiblePropertyName:key,type,isSystem:false,showInKanbanSwimlane:false} as KeyMapping);
function setup(columns: KanbanAxis = axis('tags','list'), rows: KanbanAxis|null = null, tasks: IndexedTask[] = []) {
 const s=settings(), p=cloneDefaultKanbanPresets()[0]; p.axes={version:1,columns,swimlanes:rows};
 const native={getTypes:()=>({}),getRevision:()=>1,isReady:()=>true,getTask:()=>({available:true,revision:'1',properties:new Map()})};
 const options: KanbanGroupingOptions={preset:p,settings:s,tasks,propertyAccess:createKanbanPropertyAccess(s,native),revision:{tasks:1,settings:1}};
 return {s,p,options,refresh:()=>{options.propertyAccess=createKanbanPropertyAccess(s,native);}};
}
function ready(options: KanbanGroupingOptions): KanbanGroupingSnapshot {
 const result=buildKanbanGroupingSnapshot(options); assert.notEqual(result.state,'unavailable',JSON.stringify(result));
 if(result.state==='unavailable')throw new Error(result.reason);return result;
}
const labels=(s: KanbanGroupingSnapshot)=>s.columns.map(h=>h.label);
const types=['text','number','date','datetime','checkbox','list'] as const;
const samples={text:'A',number:'01',date:'2026-10-27',datetime:'2026-10-27T09:30',checkbox:'false',list:'a; b'};
for(const left of types)for(const right of types)test(`${left} × ${right} preserves typed memberships`,()=>{
 const f=setup(axis('L',left),axis('R',right),[task('one',{L:samples[left],R:samples[right]})]);
 f.s.keyMappings.push(custom('L',left),custom('R',right));f.refresh();
 const result=ready(f.options);assert.equal(result.state,'ready');assert.equal(result.total,1);
 for(const col of result.columns)for(const row of result.rows)assert.deepEqual(result.getCellTaskIds(col.key,row.key),['one']);
 assert.ok(result.columns.length);assert.ok(result.rows.length);
});
test('two assignees and three tags produce six cells but one board task',()=>{
 const one=task('one',{assignees:'Ada; Ben'},['book','action','work','book']);
 const f=setup(axis('assignees','list'),axis('tags','list'),[one,one]);const s=ready(f.options);
 assert.equal(s.columns.length,2);assert.equal(s.rows.length,3);assert.equal(s.total,1);
 let sum=0;for(const c of s.columns)for(const r of s.rows){sum+=s.getCellCount(c.key,r.key);assert.deepEqual(s.getCellTaskIds(c.key,r.key),['one']);}
 assert.equal(sum,6);assert.ok([...s.columns,...s.rows].every(h=>h.count===1));
});
test('same list and same scalar axes are unrestricted and read each property only once per task',()=>{
 for(const [a,t,expected] of [[axis('tags','list'),task('one',{},['a','b']),4],[axis('estimate','number'),task('one',{estimate:'1'}),1]] as const){
  const f=setup(a,a,[t]);let reads=0;const reader=f.options.propertyAccess;f.options.propertyAccess={...reader,read:(...args)=>{reads++;return reader.read(...args);}};
  const s=ready(f.options);let cells=0;for(const c of s.columns)for(const r of s.rows)cells+=s.getCellCount(c.key,r.key);
  assert.equal(cells,expected);assert.equal(reads,1);
 }
 const f=setup(axis('estimate','number',[value(1)]),axis('estimate','number',[value(2)]),[task('one',{estimate:'1'})]);
 const s=ready(f.options);assert.equal(s.total,0);assert.equal(s.getCellCount(s.columns[0].key,s.rows[0].key),0);
});
test('All domains precede search and axis selections, retain unused choices and ignore stale pipeline',()=>{
 const f=setup(axis('estimate','number'),axis('tags','list',[value('keep'),value('unused')]),[
  task('alpha',{estimate:'1'},['keep']),task('beta',{estimate:'5'},['other']),task('gamma',{estimate:'20'},['keep'])]);
 f.p.pipelineId='not-real';f.options.searchQuery='alpha';f.options.taskIdFilter=['alpha'];
 const s=ready(f.options);assert.deepEqual(labels(s),['1','5','20']);assert.deepEqual(s.rows.map(h=>h.label),['keep','unused']);assert.equal(s.total,1);
 assert.deepEqual(s.columns.map(h=>h.count),[1,0,0]);
});
test('base filter excludes values before domains are discovered',()=>{
 const f=setup(axis('estimate','number'),null,[task('alpha',{estimate:'1'}),task('beta',{estimate:'5'})]);
 const condition={id:'c',field:'description',fieldType:'text' as const,operator:'contains',value:'alpha'};
 f.options.filterSet={id:'f',name:'Filter',conditions:[condition],matchLogic:'all',rootGroup:{id:'g',logic:'all',children:[condition]},sorts:[]} as FilterSet;
 assert.deepEqual(labels(ready(f.options)),['1']);
});
test('numeric equality, false and empty retain separate identities and selected ordering',()=>{
 const f=setup(axis('estimate','number'),null,[task('one',{estimate:'01'}),task('two',{estimate:'1.0'}),task('zero',{estimate:'0'}),task('empty')]);
 const s=ready(f.options);assert.deepEqual(s.columns.map(h=>h.value),[value(0),value(1),{kind:'empty'}]);assert.deepEqual(s.columns.map(h=>h.count),[1,2,1]);
 const g=setup(axis('Flag','checkbox',[{kind:'empty'},value(false),value(true)]),null,[task('false',{Flag:'false'}),task('empty')]);g.s.keyMappings.push(custom('Flag','checkbox'));g.refresh();
 assert.deepEqual(ready(g.options).columns.map(h=>h.count),[1,1,0]);
});
test('dates and datetimes remain exact; text ties do not collapse and keys cannot collide',()=>{
 const f=setup(axis('Date','datetime'),null,[task('a',{Date:'2026-10-27T09:00'}),task('b',{Date:'2026-10-27T14:30'})]);f.s.keyMappings.push(custom('Date','datetime'));f.refresh();
 assert.deepEqual(labels(ready(f.options)),['2026-10-27T09:00','2026-10-27T14:30']);
 const g=setup(axis('tags','list'),axis('tags','list'),[task('a',{},['A','a','a::b','__kanban_no_value__'])]);
 const s=ready(g.options);assert.equal(s.columns.length,4);const keys=new Set();for(const c of s.columns)for(const r of s.rows)keys.add(buildKanbanGroupingCellKey(c.key,r.key));assert.equal(keys.size,16);
 assert.notEqual(buildKanbanGroupingCellKey('a::b','c'),buildKanbanGroupingCellKey('a','b::c'));
});
test('priority uses taxonomy order and IDs, explicit missing IDs fail',()=>{
 const f=setup(axis('priority'),null,[]);const s=ready(f.options);assert.deepEqual(s.columns.map(h=>h.value),f.s.priorities.map(p=>({kind:'priority',id:p.id})));
 f.options.tasks=[task('empty')];assert.equal(ready(f.options).columns.at(-1)?.value?.kind,'empty');
 f.p.axes={version:1,columns:axis('priority','text',[{kind:'priority',id:'removed'}]),swimlanes:null};assert.equal(buildKanbanGroupingSnapshot(f.options).state,'unavailable');
});
test('Status membership is pipeline-qualified on either axis, missing pipeline is unavailable',()=>{
 const f=setup();const pipeline=f.s.pipelines[0], status=pipeline.statuses[0];const other=structuredClone(pipeline);other.id='other';other.name='Other';f.s.pipelines.push(other);
 f.p.axes={version:1,columns:{kind:'status',pipelineId:pipeline.id},swimlanes:{kind:'status',pipelineId:other.id}};
 f.options.tasks=[task('a',{status:`${pipeline.name}.${status.label}`})];f.refresh();const s=ready(f.options);assert.equal(s.total,0);assert.notEqual(s.columns[0].key,s.rows[0].key);
 f.p.axes={version:1,columns:{kind:'status',pipelineId:null},swimlanes:null};assert.equal(buildKanbanGroupingSnapshot(f.options).state,'unavailable');
});
test('partial native data keeps good values, never buckets failures as empty and rebuilds on new revision',()=>{
 const f=setup(axis('Effort','number',[],'native'),null,[task('good'),task('waiting'),task('bad'),task('empty')]);
 let pending=true;const native={getTypes:()=>({Effort:'number'} as ReturnType<NativePropertyIndex['getTypes']>),getRevision:()=>pending?1:2,
 isReady:(tasks:readonly IndexedTask[])=>!pending||tasks[0].operonId!=='waiting',getTask:(t:IndexedTask)=>({available:t.operonId!=='bad',revision:'1',properties:new Map(t.operonId==='empty'?[]:[['effort',{sourceName:'Effort',present:true,type:'number' as const,value:t.operonId==='good'?5:20}]])})};
 f.options.propertyAccess=createKanbanPropertyAccess(f.s,native);const s=ready(f.options);assert.equal(s.state,'partial');assert.equal(s.countsComplete,false);assert.equal(s.total,2);assert.equal(s.diagnostics.length,2);assert.deepEqual(s.columns.map(h=>h.count),[1,1]);
 pending=false;f.options.propertyAccess=createKanbanPropertyAccess(f.s,native);f.options.tasks=f.options.tasks.filter(t=>t.operonId!=='bad');const next=ready(f.options);assert.equal(next.state,'ready');assert.equal(next.total,3);assert.equal(next.revision.native,2);assert.equal(s.total,2);
});
test('invalid values are partial; missing fields, changed types and future presets are unavailable',()=>{
 const f=setup(axis('estimate','number'),null,[task('good',{estimate:'1'}),task('bad',{estimate:'no'})]);assert.equal(ready(f.options).state,'partial');
 for(const columns of [axis('missing'),axis('estimate','date')]){f.p.axes={version:1,columns,swimlanes:null};assert.equal(buildKanbanGroupingSnapshot(f.options).state,'unavailable');}
 f.p.axes={version:999};assert.equal(buildKanbanGroupingSnapshot(f.options).state,'unavailable');
});
test('sorts reuse global/Status override/manual behavior without modifying source or following settings edits',()=>{
 const f=setup(axis('tags','list'),null,[task('z',{},['x']),task('a',{},['x'])]);const before=JSON.stringify(f.options.tasks);let s=ready(f.options);const c=s.columns[0].key,r=s.rows[0].key;
 assert.deepEqual(s.getCellTaskIds(c,r),['a','z']);f.p.sortRules=[{field:'alphabetical',direction:'desc',empty:'last'}];assert.deepEqual(s.getCellTaskIds(c,r),['a','z']);
 s=ready(f.options);assert.deepEqual(s.getCellTaskIds(c,r),['z','a']);f.p.sortMode='manual';s=ready(f.options);assert.deepEqual(s.getCellTaskIds(c,r,['a','a','absent','z']),['a','z']);assert.equal(JSON.stringify(f.options.tasks),before);
 const pipeline=f.s.pipelines[0],status=pipeline.statuses[0];f.p.axes={version:1,columns:{kind:'status',pipelineId:pipeline.id},swimlanes:null};f.p.sortMode='automatic';f.p.columnSortOverrides=[{statusId:status.id,sortMode:'manual',sortRules:[]}];f.options.tasks=f.options.tasks.map(t=>({...t,fieldValues:{status:`${pipeline.name}.${status.label}`}}));
 s=ready(f.options);assert.deepEqual(s.getCellTaskIds(s.columns[0].key,s.rows[0].key,['a','z']),['a','z']);
});
test('legacy query parity for complete Status × Tags snapshots',()=>{
 const f=setup();delete f.p.axes;f.p.swimlaneBy='tags';const pipeline=f.s.pipelines.find(p=>p.id===f.p.pipelineId)!;
 f.options.tasks=[task('z',{status:`${pipeline.name}.${pipeline.statuses[0].label}`},['x','y']),task('a',{status:`${pipeline.name}.${pipeline.statuses[1].label}`},['x'])];f.refresh();
 const legacy=queryKanbanBoard({preset:f.p,pipeline,pipelines:f.s.pipelines,tasks:[...f.options.tasks],priorities:f.s.priorities,keyMappings:f.s.keyMappings,filterSet:null});const s=ready(f.options);
 assert.equal(s.total,legacy.relevantTasks.length);assert.deepEqual(s.columns.map(c=>c.count),legacy.columns.map(c=>c.count));assert.deepEqual(s.rows.map(r=>r.count),legacy.lanes.map(r=>r.count));
 for(let c=0;c<s.columns.length;c++)for(let r=0;r<s.rows.length;r++)assert.deepEqual(s.getCellTaskIds(s.columns[c].key,s.rows[r].key),(legacy.cellMap.get(buildKanbanCellKey(legacy.columns[c].statusId,legacy.lanes[r].key))??[]).map(t=>t.operonId));
});
test('conflicting duplicate identities are diagnosed rather than counted twice',()=>{
 const f=setup(axis('tags','list'),null,[task('same',{},['a']),task('same',{},['b'])]);const s=ready(f.options);assert.equal(s.total,0);assert.equal(s.state,'partial');assert.equal(s.diagnostics[0].reason,'duplicate-task-identity');
});
test('tracked-on filter preserves scoped sort values without changing canonical task values',()=>{
 const base=task('one',{duration:'999',trackers:'2026-10-27T10:00:00/2026-10-27T11:00:00'},['x']);
 const f=setup(axis('tags','list'),null,[base,task('outside',{trackers:'2026-10-26T10:00:00/2026-10-26T11:00:00'},['y'])]);
 const condition={id:'c',field:'trackedOn',fieldType:'date' as const,operator:'dateIs',value:'2026-10-27'};
 f.options.filterSet={id:'f',name:'Tracked',conditions:[condition],matchLogic:'all',rootGroup:{id:'g',logic:'all',children:[condition]},sorts:[]};
 f.options.filterEvaluationOptions={today:'2026-10-27'};
 const s=ready(f.options);assert.equal(s.total,1);assert.equal(getTimeScopedFieldValues(s.getTask('one')!.fieldValues).duration,'3600');assert.equal(base.fieldValues.duration,'999');assert.deepEqual(labels(s),['x']);
});
test('10,000 tasks and 60,000 possible cells store linear memberships and do not reread on cell access',()=>{
 const tasks=Array.from({length:10000},(_,i)=>task(`t${i}`,{L:String(i%200),R:String(i%300)}));const f=setup(axis('L','number'),axis('R','number'),tasks);f.s.keyMappings.push(custom('L','number'),custom('R','number'));f.refresh();let reads=0;const reader=f.options.propertyAccess;f.options.propertyAccess={...reader,read:(...args)=>{reads++;return reader.read(...args);}};
 const start=performance.now(),s=ready(f.options);console.log(`Grouping 10000 tasks / 60000 potential cells: ${(performance.now()-start).toFixed(1)}ms`);
 assert.equal(s.columns.length,200);assert.equal(s.rows.length,300);assert.equal(s.total,10000);assert.equal(reads,20000);
 assert.equal([...s.columnMembers.values(),...s.rowMembers.values()].reduce((sum,set)=>sum+set.size,0),20000);
 assert.equal('cellMap' in s,false);for(let i=0;i<40;i++){s.getCellCount(s.columns[i].key,s.rows[i].key);s.getCellTaskIds(s.columns[i].key,s.rows[i].key);}assert.equal(reads,20000);
});
test('500 × 500 list fanout stores 1000 memberships, not 250000 task copies',()=>{
 const values=Array.from({length:500},(_,i)=>`v${i}`);const f=setup(axis('tags','list'),axis('tags','list'),[task('one',{},values)]);const s=ready(f.options);
 assert.equal([...s.columnMembers.values(),...s.rowMembers.values()].reduce((sum,set)=>sum+set.size,0),1000);assert.equal(s.getCellCount(s.columns[499].key,s.rows[0].key),1);assert.equal(s.getTask('one'),f.options.tasks[0]);
});
test('frozen input is not mutated and cell result arrays are independent',()=>{
 const f=setup(axis('tags','list'),null,[task('one',{},['x'])]);
 const freeze=(object:unknown):void=>{if(object&&typeof object==='object'){for(const v of Object.values(object))freeze(v);Object.freeze(object);}};freeze(f.s);freeze(f.p);freeze(f.options.tasks);
 const s=ready(f.options),c=s.columns[0].key,r=s.rows[0].key;const ids=s.getCellTaskIds(c,r);ids.push('bad');assert.deepEqual(s.getCellTaskIds(c,r),['one']);assert.equal(s.getCellCount('missing',r),0);
});

async function nativeFixture() {
 const s = settings(); s.keyMappings = s.keyMappings.map(m => ({ ...m, visiblePropertyName: m.canonicalKey }));
 const contents = new Map([
  ['File.md', '---\noperonId: file001\nEffort: 0\nFlag: false\nItems: ["a; b", 0, "0"]\n---\n'],
  ['Inline.md', '---\nEffort: 99\n---\n- [ ] First {{operonId:: line001}} {{Effort:: 5}} {{Flag:: false}}\n- [ ] Second {{operonId:: line002}} {{Effort:: 20}}\n'],
 ]);
 const files = new Map([...contents.keys()].map(path => { const f = new TFile(...([path] as unknown as [])); Object.assign(f, { path, basename: path.slice(0,-3), extension: 'md', stat: { mtime: 1, ctime: 1, size: 1 } }); return [path,f]; }));
 let reads = 0;
 const app = { vault: { configDir: '.obsidian', getAbstractFileByPath: (p: string) => files.get(p),
 read: async (f: TFile) => { reads++; return contents.get(f.path)!; } }, metadataCache: { getFileCache: () => ({}) } } as unknown as App;
 const native = new NativePropertyIndex(app); native.configure(s); native.setTypes({ Effort: 'number', Flag: 'checkbox', Items: 'multitext', Missing: 'text' });
 const tasks: IndexedTask[] = [];
 for (const [path, file] of files) {
  const scan = await scanFileWithMappings(app, file, s.keyMappings);
  native.accept(path, scan.nativeProperties);
  if (scan.yamlTask) tasks.push({ ...task(scan.yamlTask.operonId, scan.yamlTask.fieldValues), primary: { filePath:path, format:'yaml', lineNumber:0 } });
  for (const parsed of scan.inlineTasks) tasks.push({ ...task(parsed.operonId!, parsed.fields.reduce((a,f) => ({ ...a, [f.key]: f.value }), {})),
   primary: { filePath: path, format: 'inline', lineNumber: parsed.lineNumber } });
 }
 native.reconcile(tasks, new Set());
 return { s, native, tasks, reads: () => reads };
}

test('actual native index groups file and neighboring inline values with zero extra file reads',async()=>{
 const f=await nativeFixture(),p=cloneDefaultKanbanPresets()[0];p.axes={version:1,columns:axis('Effort','number',[],'native'),swimlanes:null};
 const options:KanbanGroupingOptions={preset:p,settings:f.s,tasks:f.tasks,propertyAccess:createKanbanPropertyAccess(f.s,f.native),revision:{tasks:1,settings:1}};
 const before=f.reads(),s=ready(options);assert.deepEqual(labels(s),['0','5','20']);assert.equal(s.total,3);
 for(let i=0;i<10;i++)for(const c of s.columns)assert.equal(s.getCellCount(c.key,s.rows[0].key),1);
 assert.equal(f.reads(),before);
 f.native.setTypes({...f.native.getTypes(),Added:'text'});assert.equal(buildKanbanGroupingSnapshot(options).state,'unavailable');
 f.native.markPending(f.tasks[0].primary.filePath);
 options.propertyAccess=createKanbanPropertyAccess(f.s,f.native);assert.equal(ready(options).state,'partial');
 f.native.dispose();
});
test('native alias and canonical reference share one read and the same membership identity',()=>{
 const f=setup(axis('Effort','number',[],'native'),axis('effort','number'),[task('one',{effort:'5'})]);
 f.s.keyMappings.push({...custom('effort','number'),visiblePropertyName:'Effort'});f.refresh();
 let reads=0;const reader=f.options.propertyAccess;f.options.propertyAccess={...reader,read:(...args)=>{reads++;return reader.read(...args);}};
 const s=ready(f.options);assert.equal(reads,1);assert.equal(s.columns[0].key,s.rows[0].key);assert.equal(s.total,1);
});
test('Status on rows works with a generic column and keeps configured empty statuses',()=>{
 const f=setup(axis('tags','list'));const pipeline=f.s.pipelines[0];f.p.axes={version:1,columns:axis('tags','list'),swimlanes:{kind:'status',pipelineId:pipeline.id}};
 f.options.tasks=[task('one',{status:`${pipeline.name}.${pipeline.statuses[0].label}`},['x'])];f.refresh();const s=ready(f.options);
 assert.equal(s.total,1);assert.equal(s.rows.length,pipeline.statuses.length);assert.equal(s.getCellCount(s.columns[0].key,s.rows[0].key),1);
});

test('equivalent copies of the same task count once, including reordered object keys',()=>{
 const one=task('one',{estimate:'1',note:'same'},['x']),copy=structuredClone(one);copy.fieldValues={note:'same',estimate:'1'};
 const f=setup(axis('tags','list'),null,[one,copy]);const s=ready(f.options);assert.equal(s.total,1);assert.equal(s.state,'ready');assert.equal(s.getTask('one'),one);
 f.options.tasks=[one,{...copy,primary:{...copy.primary,filePath:'another.md'}}];assert.equal(ready(f.options).state,'partial');assert.equal(ready(f.options).total,0);
});
