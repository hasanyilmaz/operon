import test from 'node:test';
import assert from 'node:assert/strict';
import { Setting, type App } from 'obsidian';
import { DEFAULT_SETTINGS, migrateSettings } from '../src/types/settings';
import { cloneDefaultKanbanPresets } from '../src/types/kanban';
import { resolveKanbanAxes, setKanbanPresetAxes, kanbanAxisValueKey } from '../src/core/kanban-axis-model';
import { renderKanbanAxisSettings, kanbanTaskCountLabels } from '../src/ui/kanban/kanban-axis-settings';
import { createKanbanPropertyAccess } from '../src/core/kanban-axis-properties';
import { buildKanbanGroupingSnapshot } from '../src/systems/kanban-grouping';
import { axisPicker } from './test-support/kanban-axis-picker-stub';
import { withSettingsFixture } from './test-support/settings-preservation-harness';
import type { IndexedTask } from '../src/types/fields';
import { KanbanPickerSession } from '../src/ui/kanban/kanban-picker-session';
import { KanbanPresetQuickSettingsModal } from '../src/ui/kanban/kanban-preset-quick-settings-modal';
import { nativeFixture } from './test-support/kanban-native-fixture';
import { getNativePropertyIndex } from '../src/indexer/native-property-index';
import { collectKanbanAxisValueChoices } from '../src/ui/kanban/kanban-axis-values';
import { getVaultPropertyValueCandidates, invalidateCustomFieldValueCandidateCache } from '../src/ui/custom-field-surfaces';

type Control={label:string;icon:string;disabled:boolean;click:()=>void;change:(value:string|boolean)=>void;items:Record<string,string>};
type Row={name:string;description?:string;controls:Control[]};
const rows:Row[]=[];
const proto=Setting.prototype as unknown as Record<string,Function>;
proto.setName=function(name:string){this.row={name,controls:[]};rows.push(this.row);return this;};
proto.setDesc=function(description:string){this.row.description=description;return this;};
for(const method of ['addText','addButton','addDropdown','addExtraButton','addToggle']) proto[method]=function(build:Function){
	const c:Control={label:'',icon:'',disabled:false,click(){},change(){},items:{}};
	const component={buttonEl:{isConnected:true,textContent:""},setValue(){return component;},setPlaceholder(){return component;},setTooltip(){return component;},setButtonText(v:string){c.label=v;component.buttonEl.textContent=v;return component;},setIcon(v:string){c.icon=v;return component;},setDisabled(v:boolean){c.disabled=v;return component;},onClick(fn:()=>void){c.click=fn;return component;},onChange(fn:(v:string|boolean)=>void){c.change=fn;return component;},addOption(k:string,v:string){c.items[k]=v;return component;}};
	this.row.controls.push(c);build(component);return this;
};
function ui(){const settings=migrateSettings(structuredClone(DEFAULT_SETTINGS)),original=cloneDefaultKanbanPresets()[0],preset=structuredClone(original);
	const tasks: IndexedTask[] = ['01','1.0','5'].map((estimate,index)=>({operonId:`task${index}`,description:'Task',fieldValues:{estimate,taskType:index===2?'Project':'Task'},tags:index===0?['book']:['action'],checkbox:'open',tier:'hot',datetimeModified:'',primary:{filePath:'Tasks.md',format:index===2?'yaml':'inline',lineNumber:index}}));
	const app={vault:{configDir:'.obsidian',adapter:{exists:async()=>false},getMarkdownFiles:()=>[]},metadataCache:{getFileCache:()=>null}} as unknown as App;
	const host={createEl(){}} as unknown as HTMLElement;
	let side:'columns'|'swimlanes'='columns';let preparePicker: Parameters<typeof renderKanbanAxisSettings>[0]['preparePicker'];
	let onPropertyPickerOpen: (()=>void)|undefined;
	const render=()=>{rows.length=0;renderKanbanAxisSettings({app,container:host,host,side,preset,settings,tasks,preparePicker,onPropertyPickerOpen,refresh:render,retainPicker(){}});};
	const choose=(key:string)=>{rows.find(r=>r.name==='Property')!.controls[0].click();const option=axisPicker?.fields?.find(f=>f.descriptor.reference.key===key);assert.ok(option);axisPicker!.onSelect(option);};
	const current=()=>{const r=resolveKanbanAxes(preset,settings.keyMappings);assert.ok(r.ok);return r.axes;};
	render();return {app,tasks,settings,preset,original,render,choose,current,setPropertyOpen(fn:()=>void){onPropertyPickerOpen=fn;render();},setPrepare(fn:typeof preparePicker){preparePicker=fn;render();},setSide(value:typeof side){side=value;render();},add(raw:string){rows.find(r=>r.name==='Add value')!.controls[0].click();const option=axisPicker!.options.find(o=>String(o.typed.value)===raw);assert.ok(option);axisPicker!.onSelect(option);}};
}
test('Status reveals pipeline on both axes; changing one property leaves the other intact',()=>{
	const f=ui();assert.ok(rows.some(r=>r.controls.some(c=>Object.keys(c.items).length>0)));f.choose('estimate');f.add('1');
	const before=f.current().columns;f.setSide('swimlanes');f.choose('status');assert.deepEqual(f.current().columns,before);
	assert.ok(rows.some(r=>r.controls.some(c=>Object.keys(c.items).length>0)));assert.ok(!rows.some(r=>r.name==='Add value'));
});
test('number values deduplicate; selected rows reorder, remove and return to All',()=>{
	const f=ui();f.choose('estimate');f.add('1');rows.find(r=>r.name==='Add value')!.controls[0].click();assert.ok(!axisPicker!.options.some(o=>o.typed.value===1));f.add('5');let a=f.current().columns;assert.equal(a.kind,'property');if(a.kind!=='property')return;assert.equal(a.values.length,2);
	rows.find(r=>r.name==='5')!.controls.find(c=>c.icon==='arrow-up')!.click();a=f.current().columns;assert.equal(a.kind,'property');if(a.kind!=='property')return;assert.deepEqual(a.values,[{kind:'value',value:5},{kind:'value',value:1}]);
	for(let i=0;i<2;i++)rows.find(r=>r.controls.some(c=>c.icon==='x'))!.controls.find(c=>c.icon==='x')!.click();assert.ok(!rows.some(r=>r.name==='All values'));assert.equal(rows.find(r=>r.name==='Add value')!.description,"Leave empty to show all values in the board’s filter scope.");assert.equal(f.original.axes,undefined);
});
test('same property and value are selectable on both axes, with no shared draft arrays',()=>{
	const f=ui();f.choose('tags');f.add('book');f.setSide('swimlanes');f.choose('tags');f.add('book');f.add('action');const a=f.current();assert.ok(a.columns.kind==='property'&&a.swimlanes?.kind==='property');assert.equal(a.columns.values.length,1);assert.equal(a.swimlanes.values.length,2);
});
test('No value is an explicit option and automatic fields are absent',()=>{
	const f=ui();rows[0].controls[0].click();assert.ok(!axisPicker!.fields!.some(f=>['duration','totalDuration','progress','operonId'].includes(f.descriptor.reference.key)));
	f.choose('priority');rows.find(r=>r.name==='Add value')!.controls[0].click();assert.ok(axisPicker!.options.some(o=>o.typed.kind==='empty'));assert.equal(axisPicker!.options.length,f.settings.priorities.length+1);
});
test('picker ranks unique scoped counts while retaining global unused values and No value',()=>{
	const f=ui();f.tasks[0].tags=['book','book'];f.tasks[1].tags=[];f.tasks[2].tags=['outside'];
	const access=createKanbanPropertyAccess(f.settings,getNativePropertyIndex(f.app)),reference={source:'managed' as const,key:'tags',type:'list' as const};
	const resolved=access.resolve(reference);assert.ok(resolved.ok);
	f.app.vault.getMarkdownFiles=()=>[{path:'Options.md'}] as ReturnType<App['vault']['getMarkdownFiles']>;
	f.app.metadataCache.getFileCache=()=>({frontmatter:{tags:['zebra','alpha']}});
	const preset={...f.preset,axes:{version:1,columns:{kind:'property',property:reference,values:[]},swimlanes:null}};
	const scope=buildKanbanGroupingSnapshot({preset,settings:f.settings,tasks:f.tasks.slice(0,2),revision:{tasks:0,settings:0},propertyAccess:access});
	const choices=collectKanbanAxisValueChoices({app:f.app,tasks:f.tasks,field:resolved.field,access,settings:f.settings,counts:new Map(scope.state==='unavailable'?[]:scope.columns.flatMap(h=>h.value?[[kanbanAxisValueKey(h.value),h.count] as const]:[])),label:v=>v.kind==='empty'?'No value':v.kind==='value'?String(v.value):''});
	assert.deepEqual(choices.map(c=>[c.label,c.count]),[['book',1],['No value',1],['alpha',0],['outside',0],['zebra',0]]);
	assert.notEqual(scope.state,'unavailable');if(scope.state!=='unavailable')assert.deepEqual(scope.columns.map(c=>c.value),[{kind:'value',value:'book'},{kind:'empty'}]);
});
test('picker exposes counts, including zero No value, without changing explicit selection or board All',()=>{
	const f=ui();f.choose('tags');rows.find(r=>r.name==='Add value')!.controls[0].click();
	assert.deepEqual(axisPicker!.options.map(o=>[o.label,o.trailingText]),[['action','2'],['book','1'],['No value','0']]);
	const before=structuredClone(f.current());assert.deepEqual(f.current(),before);
	axisPicker!.onSelect(axisPicker!.options.find(o=>o.typed.kind==='empty'));const columns=f.current().columns;assert.equal(columns.kind,'property');if(columns.kind==='property')assert.deepEqual(columns.values,[{kind:'empty'}]);
});
test('typed vault candidates reuse editor cache and preserve list members until invalidation',()=>{
	const f=ui();let reads=0;const frontmatter={List:['semi;colon','quote"',0],Number:20,Check:false};
	f.app.vault.getMarkdownFiles=()=>[{path:'Options.md'}] as ReturnType<App['vault']['getMarkdownFiles']>;
	f.app.metadataCache.getFileCache=()=>{reads++;return {frontmatter};};
	assert.deepEqual(getVaultPropertyValueCandidates(f.app,['list']),[['semi;colon','quote"',0]]);
	assert.deepEqual(getVaultPropertyValueCandidates(f.app,['NUMBER','check']),[20,false]);assert.equal(reads,1);
	frontmatter.Number=30;invalidateCustomFieldValueCandidateCache(f.app);assert.deepEqual(getVaultPropertyValueCandidates(f.app,['Number']),[30]);assert.equal(reads,2);
});
test('legacy metadata values use editor list and tag normalization',()=>{
	const f=ui();f.app.vault.getMarkdownFiles=()=>[{path:'Options.md'}] as ReturnType<App['vault']['getMarkdownFiles']>;
	f.app.metadataCache.getFileCache=()=>({frontmatter:{tags:['#book'],contexts:['home; office']}});
	f.choose('tags');rows.find(r=>r.name==='Add value')!.controls[0].click();assert.equal(axisPicker!.options.filter(o=>o.label==='book').length,1);assert.ok(!axisPicker!.options.some(o=>o.label==='#book'));
	f.choose('contexts');rows.find(r=>r.name==='Add value')!.controls[0].click();assert.deepEqual(axisPicker!.options.map(o=>[o.label,o.trailingText]),[['No value','3'],['home','0'],['office','0']]);
});
test('legacy numeric list members, colors and icons match task-reader identities',()=>{
	const f=ui();f.tasks[0].fieldValues.contexts='0';f.tasks[0].fieldValues.taskColor='ff9900';f.tasks[0].fieldValues.taskIcon='star';
	f.app.vault.getMarkdownFiles=()=>[{path:'Options.md'}] as ReturnType<App['vault']['getMarkdownFiles']>;
	const frontmatter=Object.fromEntries([['contexts',[0]],['taskColor','#ff9900'],['taskIcon','lucide-star']].map(([key,value])=>[f.settings.keyMappings.find(m=>m.canonicalKey===key)!.visiblePropertyName,value]));
	f.app.metadataCache.getFileCache=()=>({frontmatter});
	for(const [key,expected] of [['contexts','0'],['taskColor','ff9900'],['taskIcon','star']]){f.choose(key);rows.find(r=>r.name==='Add value')!.controls[0].click();assert.deepEqual(axisPicker!.options.map(o=>[o.label,o.trailingText]),[['No value','2'],[expected,'1']]);}
});
test('swimlane toggle is first, hides controls, and restores ordered values independently of columns',()=>{
	const f=ui();f.setSide('swimlanes');f.choose('tags');f.add('book');f.add('action');const before=structuredClone(f.current().swimlanes);
	assert.equal(rows[0].name,'Enable swimlanes');rows[0].controls[0].change(false);assert.deepEqual(rows.map(r=>r.name),['Enable swimlanes']);assert.equal(f.current().swimlanes,null);
	f.setSide('columns');f.choose('estimate');f.add('5');f.setSide('swimlanes');rows[0].controls[0].change(true);
	assert.deepEqual(f.current().swimlanes,before);assert.equal(f.current().inactiveSwimlanes,undefined);assert.ok(!rows.some(r=>r.name==='All values'));assert.equal(f.original.axes,undefined);
});
test('status swimlane toggle restores pipeline and does not show value controls',()=>{
	const f=ui();f.setSide('swimlanes');f.choose('status');const id=f.settings.pipelines[0].id;rows.find(r=>r.name==='Pipeline')!.controls[0].change(id);
	rows[0].controls[0].change(false);rows[0].controls[0].change(true);assert.deepEqual(f.current().swimlanes,{kind:'status',pipelineId:id});assert.ok(!rows.some(r=>r.name==='Add value'));
});
test('disabled swimlane choices survive save and reopening without activating the axis',async()=>withSettingsFixture({},async h=>{
	const f=ui();f.setSide('swimlanes');f.choose('tags');f.add('book');rows[0].controls[0].change(false);
	const storage=h.createStorage();await storage.initialize();const before=structuredClone(storage.getSettings().kanbanPresets[0]);
	const next={...before,axes:structuredClone(f.preset.axes),swimlaneBy:null};await storage.saveKanbanPresetIfUnchanged(before,next);
	const reopened=h.createStorage();await reopened.initialize();const saved=reopened.getSettings().kanbanPresets[0];const decoded=resolveKanbanAxes(saved,f.settings.keyMappings);assert.ok(decoded.ok);assert.equal(decoded.axes.swimlanes,null);assert.deepEqual(decoded.axes.inactiveSwimlanes,f.current().inactiveSwimlanes);
	f.preset.axes=structuredClone(saved.axes);f.render();rows[0].controls[0].change(true);assert.deepEqual(f.current().swimlanes,decoded.axes.inactiveSwimlanes);h.assertIsolation();
}));
test('property picker uses one line and includes renamed canonical keys',()=>{
	const f=ui();f.settings.keyMappings.find(m=>m.canonicalKey==='priority')!.visiblePropertyName='Tier';f.render();rows[0].controls[0].click();
	assert.equal(axisPicker!.fields!.find(f=>f.descriptor.reference.key==='priority')!.label,'Tier - priority');
	assert.ok(axisPicker!.fields!.every(f=>!f.secondaryLabel));f.choose('priority');assert.equal(rows[0].controls[0].label,'Tier - priority');
});
test('property picker opens synchronously without task reads, counts or preparation',()=>{
 const f=ui();let preparations=0;f.setPrepare(async()=>{preparations++;throw new Error('Property must not prepare tasks');});
 for(const task of f.tasks) Object.defineProperty(task,'fieldValues',{get(){throw new Error('Property must not read task values');}});
 const before=structuredClone(f.preset),button=rows.find(r=>r.name==='Property')!.controls[0],label=button.label;
 button.click();assert.equal(preparations,0);assert.equal(button.label,label);assert.equal(button.disabled,false);
 assert.ok(axisPicker!.fields!.length>0);assert.ok(axisPicker!.fields!.every(field=>field.trailingText===undefined));assert.deepEqual(f.preset,before);
});
test('both axes only offer existing values and preserve inline and file values',()=>{
	const f=ui();for(const side of ['columns','swimlanes'] as const){f.setSide(side);for(const key of ['estimate','tags','description','dateDue','datetimeStart']){f.choose(key);assert.ok(!rows.some(r=>r.name==='New value'));}
		f.choose('estimate');rows.find(r=>r.name==='Add value')!.controls[0].click();assert.deepEqual(axisPicker!.options.map(o=>o.typed),[{kind:'value',value:1},{kind:'value',value:5},{kind:'empty'}]);}
});
test('Task used only by inline tasks appears in the Type value picker on both axes',()=>{
	const f=ui();for(const side of ['columns','swimlanes'] as const){f.setSide(side);f.choose('taskType');rows.find(r=>r.name==='Add value')!.controls[0].click();assert.deepEqual(axisPicker!.options.map(o=>o.typed),[{kind:'value',value:'Task'},{kind:'value',value:'Project'},{kind:'empty'}]);}
});
test('native picker includes inline-only values from parsed sources without inheriting page values',async()=>{
	const f=await nativeFixture();const preset=cloneDefaultKanbanPresets()[0],host={createEl(){}} as unknown as HTMLElement;
	try {
		const property={kind:'property' as const,property:{source:'native' as const,key:'Effort',type:'number' as const},values:[]};
		setKanbanPresetAxes(preset,{version:1,columns:property,swimlanes:property},f.s.keyMappings);
		const reads=f.reads();
		for(const side of ['columns','swimlanes'] as const){rows.length=0;renderKanbanAxisSettings({app:f.app,container:host,host,side,preset,settings:f.s,tasks:f.tasks,refresh(){},retainPicker(){}});
			rows.find(r=>r.name==='Add value')!.controls[0].click();assert.deepEqual(axisPicker!.options.map(o=>o.typed),[{kind:'value',value:0},{kind:'value',value:5},{kind:'value',value:20},{kind:'empty'}]);}
		assert.equal(f.reads(),reads);
	} finally {f.native.dispose();}
});
test('native list picker retains numeric and string identities and literal separators',async()=>{
	const f=await nativeFixture();const preset=cloneDefaultKanbanPresets()[0],host={createEl(){}} as unknown as HTMLElement;
	try{
		f.app.metadataCache.getFileCache=()=>({frontmatter:{Items:['a; b',0,'0','unused']}});
		setKanbanPresetAxes(preset,{version:1,columns:{kind:'property',property:{source:'native',key:'Items',type:'list'},values:[]},swimlanes:null},f.s.keyMappings);
		rows.length=0;const reads=f.reads();renderKanbanAxisSettings({app:f.app,container:host,host,side:'columns',preset,settings:f.s,tasks:f.tasks,refresh(){},retainPicker(){}});
		rows.find(r=>r.name==='Add value')!.controls[0].click();const options=axisPicker!.options;
		assert.equal(options.length,5);assert.equal(options.find(o=>o.typed.value===0)?.trailingText,'1');assert.equal(options.find(o=>o.typed.value==='0')?.trailingText,'1');assert.equal(options.find(o=>o.typed.value==='a; b')?.trailingText,'1');assert.equal(options.find(o=>o.typed.value==='unused')?.trailingText,'0');assert.equal(options[0].typed.kind,'empty');assert.equal(options[0].trailingText,'2');assert.equal(f.reads(),reads);
	}finally{f.native.dispose();}
});
test('task count labels distinguish ready, pending, partial, unavailable and true empty results',async()=>{
	const f=await nativeFixture();const preset=cloneDefaultKanbanPresets()[0];preset.axes={version:1,columns:{kind:'property',property:{source:'native',key:'Effort',type:'number'},values:[]},swimlanes:null};
	try {
		const options={preset,settings:f.s,tasks:f.tasks,revision:{tasks:0,settings:0},propertyAccess:createKanbanPropertyAccess(f.s,f.native)};
		const result=buildKanbanGroupingSnapshot(options);assert.notEqual(result.state,'unavailable');if(result.state==='unavailable')return;
		assert.deepEqual(kanbanTaskCountLabels(result),{scoped:'3',board:'3'});
		assert.deepEqual(kanbanTaskCountLabels({...result,total:0,state:'partial',countsComplete:false,diagnostics:[{taskId:'line001',axis:'columns',state:'pending',reason:'index-not-ready'}]}),{scoped:'3',board:'…'});
		assert.deepEqual(kanbanTaskCountLabels({...result,total:2,state:'partial',countsComplete:false}),{scoped:'3',board:'2 · Partial'});
		assert.deepEqual(kanbanTaskCountLabels({...result,total:0,state:'partial',countsComplete:false,scopeComplete:false}),{scoped:'3 · Partial',board:'0 · Partial'});
		assert.deepEqual(kanbanTaskCountLabels({...result,state:'unavailable',axis:'columns',reason:'missing-property'}),{scoped:'3',board:'—'});
		assert.deepEqual(kanbanTaskCountLabels(buildKanbanGroupingSnapshot({...options,tasks:[]})),{scoped:'0',board:'0'});
	}finally{f.native.dispose();}
});
test('save uses expected preset and persists only the explicit draft; stale edits are rejected',async()=>withSettingsFixture({},async h=>{
	const storage=h.createStorage();await storage.initialize();const before=structuredClone(storage.getSettings().kanbanPresets[0]),next=structuredClone(before);
	setKanbanPresetAxes(next,{version:1,columns:{kind:'property',property:{source:'managed',key:'estimate',type:'number'},values:[{kind:'value',value:20}]},swimlanes:null},storage.getSettings().keyMappings);
	const attempts=h.canonicalAttempts;await storage.saveKanbanPresetIfUnchanged(before,next);assert.equal(h.canonicalAttempts,attempts+1);assert.deepEqual(storage.getSettings().kanbanPresets[0].axes,next.axes);
	await assert.rejects(storage.saveKanbanPresetIfUnchanged(before,{...before,name:'Stale'}));assert.deepEqual(storage.getSettings().kanbanPresets[0].axes,next.axes);
	const second=h.createStorage();await second.initialize();assert.deepEqual(second.getSettings().kanbanPresets[0].axes,next.axes);h.assertIsolation();
}));
for(const fault of ['throw-before','silent-before'] as const)test(`failed preset save preserves settings and order: ${fault}`,async()=>withSettingsFixture({},async h=>{
	const storage=h.createStorage();await storage.initialize();const before=structuredClone(storage.getSettings().kanbanPresets[0]),order=storage.kanbanOrder.toPackage(),raw=h.raw();h.writeFault=fault;
	await assert.rejects(storage.saveKanbanPresetIfUnchanged(before,{...before,name:'Unsaved'}));assert.deepEqual(storage.getSettings().kanbanPresets[0],before);assert.deepEqual(storage.kanbanOrder.toPackage(),order);assert.equal(h.raw(),raw);h.assertIsolation();
}));
test('duplicate is a deep copy; dormant overrides and order survive an explicit axis save',async()=>withSettingsFixture({},async h=>{
	const storage=h.createStorage();await storage.initialize();const source=structuredClone(storage.getSettings().kanbanPresets[0]);
	const copy={...source,id:'copy',name:'Copy',axes:{version:1,columns:{kind:'property',property:{source:'managed',key:'tags',type:'list'},values:[{kind:'value',value:'Unused'}]},swimlanes:null}};
	await storage.createKanbanPreset(copy,source);copy.name='Changed outside';assert.equal(storage.getSettings().kanbanPresets.find(p=>p.id==='copy')?.name,'Copy');
	const saved=structuredClone(storage.getSettings().kanbanPresets.find(p=>p.id==='copy')!);const next={...saved,columnSortOverrides:[{statusId:'dormant',sortMode:'manual' as const,sortRules:source.sortRules}]};await storage.saveKanbanPresetIfUnchanged(saved,next);assert.deepEqual(storage.getSettings().kanbanPresets.find(p=>p.id==='copy')?.columnSortOverrides,next.columnSortOverrides);
}));
test('future axes block saving and do not write or replace their content',async()=>withSettingsFixture({},async h=>{
	const storage=h.createStorage();await storage.initialize();const before=structuredClone(storage.getSettings().kanbanPresets[0]),raw=h.raw();await assert.rejects(storage.saveKanbanPresetIfUnchanged(before,{...before,axes:{version:99,opaque:['keep']}}));assert.equal(h.raw(),raw);
}));

test('uncertain disk write preserves committed memory and prevents blind retry',async()=>withSettingsFixture({},async h=>{
	const storage=h.createStorage();await storage.initialize();const before=structuredClone(storage.getSettings().kanbanPresets[0]),order=storage.kanbanOrder.toPackage(),attempts=h.canonicalAttempts;
	h.writeFault='partial-throw';await assert.rejects(storage.saveKanbanPresetIfUnchanged(before,{...before,name:'Unsaved'}));
	assert.deepEqual(storage.getSettings().kanbanPresets[0],before);assert.deepEqual(storage.kanbanOrder.toPackage(),order);
	const uncertain=h.raw();h.writeFault='none';await assert.rejects(storage.saveKanbanPresetIfUnchanged(before,{...before,name:'Retry'}));assert.equal(h.raw(),uncertain);assert.equal(h.canonicalAttempts,attempts+1);h.assertIsolation();
}));
test('queued workflow, reorder and related-preset saves preserve the latest modal edit',async()=>withSettingsFixture({},async h=>{
	const storage=h.createStorage();await storage.initialize();const before=structuredClone(storage.getSettings().kanbanPresets[0]);
	await storage.createKanbanPreset({...before,id:'second',name:'Second'});
	const a=storage.saveKanbanPresetIfUnchanged(before,{...before,name:'Saved edit'});
	const b=storage.updateSettings({pipelines:structuredClone(storage.getSettings().pipelines),defaultPipelineName:storage.getSettings().defaultPipelineName});
	const c=storage.reorderKanbanPresets(storage.getSettings().kanbanPresets.map(p=>p.id),0,1);
	const d=storage.createKanbanPreset({...before,id:'related',name:'Related'});
	await Promise.all([a,b,c,d]);assert.equal(storage.getSettings().kanbanPresets.find(p=>p.id===before.id)?.name,'Saved edit');assert.equal(storage.getSettings().kanbanPresets.at(-1)?.id,'related');assert.equal(storage.getSettings().kanbanPresets[1].id,before.id);h.assertIsolation();
}));


test('modal picker session reuses results, refreshes revisions and scope, and releases on close',async()=>{
 const f=ui();let revision=1,filterSet:typeof f.settings.filterSets[number]|undefined;
 const session=new KanbanPickerSession(f.app,()=>({settings:f.settings,tasks:f.tasks,filterSet}),()=>revision,async()=>{});
 let calculations=0;const first=await session.prepare();assert.ok(first);assert.equal(first.memo!('properties',()=>++calculations),1);
 const second=await session.prepare();assert.ok(second);assert.equal(second.memo!('properties',()=>++calculations),1);
 revision++;const changed=await session.prepare();assert.ok(changed);assert.equal(changed.memo!('properties',()=>++calculations),2);
 const condition={id:'c',field:'description',fieldType:'text' as const,operator:'contains',value:'absent'};
 filterSet={id:'f',name:'f',conditions:[condition],matchLogic:'all',rootGroup:{id:'g',logic:'all',children:[condition]},sorts:[]};
 const scoped=await session.prepare();assert.ok(scoped);assert.equal(scoped.scope.scoped.length,0);assert.equal(scoped.memo!('properties',()=>++calculations),3);
 session.invalidate();const fresh=await session.prepare();assert.ok(fresh);assert.equal(fresh.memo!('properties',()=>++calculations),4);
 session.dispose();assert.equal(await session.prepare(),null);
});
test('property labels stay count-free while asynchronous value counts are preserved',async()=>{
 const f=ui();f.choose('tags');const session=new KanbanPickerSession(f.app,()=>({settings:f.settings,tasks:f.tasks}),()=>1,async()=>{});
 let pending:Promise<unknown>=Promise.resolve();f.setPrepare(property=>{const work=session.prepare(property);pending=work;return work;});
 for(let i=0;i<2;i++){
  rows.find(r=>r.name==='Property')!.controls[0].click();await pending;await Promise.resolve();assert.equal(axisPicker!.fields!.find(f=>f.descriptor.reference.key==='tags')!.trailingText,undefined);
  rows.find(r=>r.name==='Add value')!.controls[0].click();await pending;await Promise.resolve();assert.deepEqual(axisPicker!.options.map(o=>[o.label,o.trailingText]),[['action','2'],['book','1'],['No value','0']]);
 }
 session.dispose();
});
test('chunked preparation abandons invalidated, superseded or closed work',async()=>{
 for(const mode of ['invalidate','cancelPending','dispose'] as const){
  const f=ui(),base=f.tasks[0];f.tasks.splice(0,f.tasks.length,...Array.from({length:2000},(_,i)=>({...base,operonId:'chunk'+i})));
  let yields=0;const session=new KanbanPickerSession(f.app,()=>({settings:f.settings,tasks:f.tasks}),()=>1,async()=>{yields++;session[mode]();});
  assert.equal(await session.prepare(),null);assert.ok(yields>0);session.dispose();
 }
});

test('async preparation restores the anchor label and disabled state before opening',async()=>{
 const f=ui();f.choose('tags');const session=new KanbanPickerSession(f.app,()=>({settings:f.settings,tasks:f.tasks}),()=>1,async()=>{});
 let pending:Promise<unknown>=Promise.resolve();f.setPrepare(property=>{const work=session.prepare(property);pending=work;return work;});
 const button=rows.find(r=>r.name==='Add value')!.controls[0],label=button.label;button.click();assert.equal(button.label,'…');assert.equal(button.disabled,true);
 await pending;await Promise.resolve();assert.equal(button.label,label);assert.equal(button.disabled,false);assert.ok(axisPicker!.options);session.dispose();
});

test('one click retries stale preparation and opens with the latest data',async()=>{
 const f=ui();f.choose('tags');const session=new KanbanPickerSession(f.app,()=>({settings:f.settings,tasks:f.tasks}),()=>1,async()=>{});
 const prepare=session.prepare.bind(session);let attempts=0;
 session.prepare=async property=>++attempts===1?null:prepare(property);
 let pending:Promise<unknown>=Promise.resolve();f.setPrepare(property=>{const work=session.prepareLatest(property,()=>true);pending=work;return work;});
 const button=rows.find(r=>r.name==='Add value')!.controls[0],label=button.label;button.click();await pending;await Promise.resolve();
 assert.equal(attempts,2);assert.equal(button.label,label);assert.equal(button.disabled,false);assert.ok(axisPicker!.options);session.dispose();
});
test('superseded requests stop while persistent invalidation fails after bounded retries',async()=>{
 const f=ui();const session=new KanbanPickerSession(f.app,()=>({settings:f.settings,tasks:f.tasks}),()=>1,async()=>{});
 let current=true,attempts=0;session.prepare=async()=>{attempts++;current=false;return null;};
 assert.equal(await session.prepareLatest(undefined,()=>current),null);assert.equal(attempts,1);
 session.prepare=async()=>{attempts++;return null;};attempts=0;
 await assert.rejects(session.prepareLatest(undefined,()=>true),/kept changing/);assert.equal(attempts,3);session.dispose();
});
test('an index revision arriving during chunked work recovers within the same request',async()=>{
 const f=ui(),base=f.tasks[0];f.tasks.splice(0,f.tasks.length,...Array.from({length:2000},(_,i)=>({...base,operonId:'retry'+i})));
 let revision=1,yields=0;const session=new KanbanPickerSession(f.app,()=>({settings:f.settings,tasks:f.tasks}),()=>revision,async()=>{if(++yields===1)revision++;});
 const result=await session.prepareLatest(undefined,()=>true);assert.ok(result);assert.equal(result.scope.scoped.length,2000);assert.ok(yields>0);assert.equal(revision,2);session.dispose();
});
test('failed preparation restores the loading button',async()=>{
 const f=ui();f.choose('tags');f.setPrepare(async()=>{throw new Error('preparation failed');});
 const button=rows.find(r=>r.name==='Add value')!.controls[0],label=button.label;button.click();
 await new Promise(resolve=>setTimeout(resolve,0));assert.equal(button.disabled,false);assert.equal(button.label,label);
});
test('native readiness waits for preparation and picker close instead of cancelling the click',async()=>{
 const modal=Object.create(KanbanPresetQuickSettingsModal.prototype) as {isOpen:boolean;pickerPreparing:number;pickerClose:(()=>void)|null;nativeRefreshPending:boolean;refreshNativePickerData():void;onPickerClosed():void;renderPreservingScroll():void};
 let renders=0;Object.assign(modal,{isOpen:true,pickerPreparing:1,pickerClose:null,nativeRefreshPending:false,renderPreservingScroll(){renders++;}});
 modal.refreshNativePickerData();assert.equal(renders,0);assert.equal(modal.nativeRefreshPending,true);
 modal.pickerPreparing=0;modal.pickerClose=()=>{};modal.refreshNativePickerData();assert.equal(renders,0);
 modal.onPickerClosed();await Promise.resolve();assert.equal(renders,1);
 modal.isOpen=false;modal.refreshNativePickerData();assert.equal(renders,1);
});

 test('Property supersedes a pending Add value without waiting or reopening stale choices',async()=>{
 const f=ui();f.choose('tags');
 const session=new KanbanPickerSession(f.app,()=>({settings:f.settings,tasks:f.tasks}),()=>1,async()=>{});
 const data=await session.prepare({source:'managed',key:'tags',type:'list'});assert.ok(data);
 let finish:(value:typeof data)=>void=()=>{};session.prepare=()=>new Promise(resolve=>{finish=resolve;});
 const modal=Object.assign(Object.create(KanbanPresetQuickSettingsModal.prototype),{pickerSession:session,pickerRequest:0});
 let pending:Promise<unknown>=Promise.resolve();
 f.setPrepare(property=>{const request=modal.cancelPendingPicker();const result=session.prepareLatest(property,()=>request===modal.pickerRequest);pending=result;return result;});
 f.setPropertyOpen(()=>modal.cancelPendingPicker());
 const valueButton=rows.find(r=>r.name==='Add value')!.controls[0];valueButton.click();assert.equal(valueButton.disabled,true);
 rows.find(r=>r.name==='Property')!.controls[0].click();const opened=axisPicker;assert.ok(opened!.fields);
 finish(data);await pending;await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(axisPicker,opened);assert.equal(valueButton.disabled,false);session.dispose();
 });
