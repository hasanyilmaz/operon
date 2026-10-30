import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PreparedTaskCreatorDraft } from '../src/ui/task-creator-prepared-draft';
import { parseFrontmatterDocument } from '../src/core/file-task-template-merge';
import { executeFileRecurrenceTerminalTransaction } from '../src/systems/file-recurrence-terminal-transaction';
import { executeTaskSourceRenameTransaction, TaskSourceRenameUncertainError, type TaskSourceRenamePorts } from '../src/storage/task-source-rename-transaction';
import { kanbanListLaneKeys, addKanbanListLane } from '../src/systems/kanban-list-values';
import { parseListValue } from '../src/core/parser';
import { buildKanbanWritebackPlan } from '../src/systems/kanban-writeback';
import test from 'node:test';
import assert from 'node:assert/strict';
import { TFile, type App } from 'obsidian';
import { buildKanbanCellPlan, splitKanbanCreatorSeeds, kanbanPayloadMatchesPlan, resolveLegacyKanbanCellTarget, type KanbanCellPlan } from '../src/systems/kanban-cell-actions';
import { createKanbanPropertyAccess } from '../src/core/kanban-axis-properties';
import { DEFAULT_SETTINGS, migrateSettings, type KeyMapping } from '../src/types/settings';
import { cloneDefaultKanbanPresets } from '../src/types/kanban';
import type { KanbanAxis, KanbanAxisValue, KanbanPropertyReference } from '../src/core/kanban-axis-model';
import type { IndexedTask } from '../src/types/fields';
import { NativePropertyIndex } from '../src/indexer/native-property-index';
import { scanFileWithMappings } from '../src/indexer/file-scanner';
import { TaskWriter } from '../src/core/task-writer';
import type { TaskWriterIndexerPort } from '../src/core/task-writer';
import { retainInlinePropertyDefinition } from '../src/core/inline-property-definitions';
import { readFileTaskPropertyDocument } from '../src/core/file-task-property-draft';
import { readInlinePropertyProjection } from '../src/core/inline-property-source';
import { encodeVaultPropertyValue, type VaultPropertyValue } from '../src/core/vault-property-codec';
import { createKanbanDropOptimisticMove, applyKanbanOptimisticMovesToBoard, buildOptimisticMovedTask } from '../src/systems/kanban-optimistic-move';
import {  buildKanbanCellKey } from '../src/systems/kanban-query';
import { queryKanbanBoard } from './test-support/kanban-legacy-query';
import { buildKanbanGroupingSnapshot } from '../src/systems/kanban-grouping';

const settings = () => migrateSettings(structuredClone(DEFAULT_SETTINGS));
const task = (fields: Record<string,string> = {}, tags = ['book']): IndexedTask => ({ operonId:'abc1234', primary:{filePath:'Notes.md',format:'inline',lineNumber:0}, description:'Task', fieldValues:fields,tags,checkbox:'open',tier:'hot',datetimeModified:'' });
const axis = (key:string,type:KanbanPropertyReference['type']='text',source:'native'|'managed'='managed'):KanbanAxis => ({kind:'property',property:{source,key,type},values:[]});
const value = (value:string|number|boolean):KanbanAxisValue => ({kind:'value',value});
const empty:KanbanAxisValue={kind:'empty'};
const fakeNative = { getTypes:()=>({}),getRevision:()=>1,isReady:()=>true,getTask:()=>({available:true,revision:'1',properties:new Map()}) };
function planned(result:ReturnType<typeof buildKanbanCellPlan>):KanbanCellPlan {assert.notEqual(result.state,'blocked',JSON.stringify(result));if(result.state==='blocked')throw Error(result.reason);return result;}
function setup(columns:KanbanAxis, rows:KanbanAxis|null, c:KanbanAxisValue, row:KanbanAxisValue|null, current?:IndexedTask) {
 const s=settings(); const access=createKanbanPropertyAccess(s,fakeNative);
 return {s,access,input:{axes:{version:1 as const,columns,swimlanes:rows},target:{columns:c,swimlanes:row},task:current,settings:s,access,today:'2026-10-27'}};
}

test('two scalar targets are one plan; source is unchanged',()=>{
 const current=task({note:'before',location:'old'});const before=JSON.stringify(current);
 const f=setup(axis('note'),axis('location'),value('after'),value('new'),current),p=planned(buildKanbanCellPlan(f.input));
 assert.deepEqual(p.payload,{note:'after',location:'new'});assert.deepEqual(p.expectedFieldValues,{note:'before',location:'old'});assert.equal(JSON.stringify(current),before);
 assert.equal(kanbanPayloadMatchesPlan(p,current,{...p.payload,note:'overridden'}),false);
});
test('same scalar targets agree or block; equal numeric spellings are noop',()=>{
 const f=setup(axis('estimate','number'),axis('estimate','number'),value('01'),value('1.0'),task({estimate:'1'}));
 assert.equal(planned(buildKanbanCellPlan(f.input)).state,'noop');f.input.target.swimlanes=value(2);assert.equal(buildKanbanCellPlan(f.input).state,'blocked');
});
test('lists union both targets, preserve source and avoid redundant writes',()=>{
 const f=setup(axis('tags','list'),axis('tags','list'),value('action'),value('urgent'),task());
 const p=planned(buildKanbanCellPlan(f.input));assert.deepEqual(p.nextDraft.tags,['book','action','urgent']);assert.equal(p.requirements.length,1);
 f.input.task=task({},['book','action','urgent']);assert.equal(planned(buildKanbanCellPlan(f.input)).state,'noop');
});
test('list clearing and contradictory empty/list targets are blocked',()=>{
 for(const [c,r,t] of [[empty,null,task()],[empty,value('action'),task({},[])]] as const){const f=setup(axis('tags','list'),r?axis('tags','list'):null,c,r,t);assert.equal(buildKanbanCellPlan(f.input).state,'blocked');}
 const f=setup(axis('tags','list'),null,value('action'),null,task({},[]));assert.deepEqual(planned(buildKanbanCellPlan(f.input)).nextDraft.tags,['action']);
});
test('scalar empty clears and false/zero remain actual values',()=>{
 const f=setup(axis('estimate','number'),null,empty,null,task({estimate:'0'}));assert.deepEqual(planned(buildKanbanCellPlan(f.input)).payload,{estimate:''});
});
test('new task seeds combine lists and preserve explicit empty rather than defaults',()=>{
 const f=setup(axis('tags','list'),axis('tags','list'),value('book'),value('action'));
 const p=planned(buildKanbanCellPlan(f.input));assert.deepEqual(p.seeds,[{sourceName:'tags',value:['book','action']}]);
 const g=setup(axis('priority'),null,empty,null);assert.deepEqual(planned(buildKanbanCellPlan(g.input)).seeds,[{sourceName:'priority',value:''}]);
});
test('selected values and deleted taxonomy identity cannot accept a stale target',()=>{
 const f=setup({...axis('note'),values:[value('allowed')]} as KanbanAxis,null,value('other'),null,task());assert.equal(buildKanbanCellPlan(f.input).state,'blocked');
 const g=setup(axis('priority'),null,{kind:'priority',id:'deleted'},null,task());assert.equal(buildKanbanCellPlan(g.input).state,'blocked');
});
test('status uses pipeline identity and combines terminal effects with another axis',()=>{
 const f=setup(axis('note'),null,value('x'),null,task());const pipeline=f.s.pipelines[0],status=pipeline.statuses.find(s=>s.isFinished)!;
 assert.ok(status);f.input.axes.columns={kind:'status',pipelineId:pipeline.id};f.input.target.columns={kind:'status',pipelineId:pipeline.id,id:status.id};
 f.input.axes.swimlanes=axis('tags','list');f.input.target.swimlanes=value('action');
 const p=planned(buildKanbanCellPlan(f.input));assert.equal(p.payload._checkbox,'done');assert.equal(p.payload.dateCompleted,'2026-10-27');assert.deepEqual(p.nextDraft.tags,['book','action']);
});

const samples = [['text','new text'],['number',0],['checkbox',false],['date','2028-02-29'],['datetime','2026-10-27T14:30:22+02:00'],['list','semi;colon']] as const;
async function fixture(format:'inline'|'yaml',type:KanbanPropertyReference['type']) {
 const s=settings();s.keyMappings=s.keyMappings.map(mapping=>({...mapping,visiblePropertyName:mapping.canonicalKey}));
 const pipeline=s.pipelines[0],initial=pipeline.statuses.find(status=>!status.isFinished&&!status.isCancelled)!;
 const file=new TFile(...(['Notes.md'] as unknown as []));Object.assign(file,{path:'Notes.md',basename:'Notes',extension:'md',stat:{mtime:1,ctime:1,size:1}});
 let content=format==='inline'?`---\nValue: host\n---\n- [ ] Task {{operonId:: abc1234}} {{status:: ${pipeline.name}.${initial.label}}}\n- [ ] Neighbor {{operonId:: xyz1234}} {{Value:: neighbor}}\n`:`---\noperonId: abc1234\nstatus: ${pipeline.name}.${initial.label}\nUnrelated: keep\n---\nBody\n`;
 let writes=0,reads=0,fail=false;
 const app={vault:{configDir:'.obsidian',getAbstractFileByPath:(path:string)=>path===file.path?file:null,
 read:async()=>{reads++;return content;},process:async(_file:TFile,patch:(text:string)=>string)=>{const next=patch(content);if(fail)throw Error('injected');if(next!==content){content=next;writes++;file.stat.mtime++;}return next;}},
 metadataCache:{getFileCache:()=>({frontmatter:readFileTaskPropertyDocument(content)?.frontmatter})}} as unknown as App;
 const native=new NativePropertyIndex(app);native.configure(s);native.setTypes({Value:type==='list'?'multitext':type});
 let current=task({},[]);current.primary={filePath:file.path,format,lineNumber:3};
 const refresh=async()=>{const scan=await scanFileWithMappings(app,file,s.keyMappings);native.accept(file.path,scan.nativeProperties);
 if(format==='inline'){const parsed=scan.inlineTasks.find(t=>t.operonId==='abc1234')!;current={...current,description:parsed.description,checkbox:parsed.checkbox,fieldValues:Object.fromEntries(parsed.fields.map(f=>[f.key,f.value])),tags:parsed.tags};}
 else {const parsed=scan.yamlTask!;current={...current,description:parsed.description,checkbox:s.pipelines.flatMap(p=>p.statuses.map(st=>({st,value:`${p.name}.${st.label}`}))).find(st=>st.value===parsed.fieldValues.status)?.st.isFinished?'done':'open',fieldValues:parsed.fieldValues,primary:{...current.primary,filePath:file.path}};}
 native.reconcile([current],new Set());};
 await refresh();
 const indexer={getTask:()=>current,hasDuplicateOperonIdConflict:()=>false,isPathIndexable:()=>true,reindexFilePath:async()=>{},reindexFilesBatch:async()=>{},scheduleReindex:()=>{}} as unknown as TaskWriterIndexerPort;
 const writer=new TaskWriter(app,indexer,s.keyMappings,{getInlinePropertyDefinitions:()=>s.inlinePropertyDefinitions,prepareInlineProperties:async entries=>{for(const entry of entries)s.inlinePropertyDefinitions=retainInlinePropertyDefinition(s.inlinePropertyDefinitions,entry);return s.inlinePropertyDefinitions!;}});
 return {s,native,writer,refresh,app,file,indexer,current:()=>current,content:()=>content,put:(text:string)=>{content=text;file.stat.mtime++;},writes:()=>writes,reads:()=>reads,fail:()=>{fail=true;}};
}
for(const format of ['inline','yaml'] as const)for(const [type,target] of samples)test(`${format} typed ${type} and managed note commit together once`,async()=>{
 const f=await fixture(format,type),current=f.current();
 const access=createKanbanPropertyAccess(f.s,f.native);
 const p=planned(buildKanbanCellPlan({axes:{version:1,columns:axis('Value',type,'native'),swimlanes:axis('note')},target:{columns:value(target),swimlanes:value('joined')},task:current,access,settings:f.s}));
 assert.equal(await f.writer.writeTaskFields(current.operonId,{...p.payload,datetimeModified:'2026-10-27T12:00:00'}, {mode:'merge',reindex:'none',touchAncestors:false,expectedFieldValues:p.expectedFieldValues,...(format==='inline'?{inlinePropertyDraft:p.inlinePropertyDraft}:{filePropertyDraft:p.filePropertyDraft})}),true);
 assert.equal(f.writes(),1);assert.ok(f.content().includes(format==='inline'?'Value: host':'Unrelated: keep'));assert.ok(f.content().includes(format==='inline'?'Neighbor':'Body'));
 assert.equal(await f.writer.taskFieldsMatchCurrentSource(current.operonId,{note:'joined'},format==='yaml'?p.filePropertyDraft:undefined,format==='inline'?p.inlinePropertyDraft:undefined),true);
 await f.refresh();const read=createKanbanPropertyAccess(f.s,f.native).read(f.current(),{source:'native',key:'Value',type});assert.equal(read.state,'ready');if('values'in read)assert.deepEqual(read.values,[value(target)]);f.native.dispose();
});
for(const format of ['inline','yaml'] as const)test(`${format} stale native expected value blocks the entire managed/native write`,async()=>{
 const f=await fixture(format,'number'),current=f.current();const p=planned(buildKanbanCellPlan({axes:{version:1,columns:axis('Value','number','native'),swimlanes:axis('note')},target:{columns:value(5),swimlanes:value('joined')},task:current,access:createKanbanPropertyAccess(f.s,f.native),settings:f.s}));
 f.put(format==='inline'?f.content().replace('}}\n- [ ] Neighbor','}} {{Value:: 7}}\n- [ ] Neighbor'):f.content().replace('Unrelated: keep','Unrelated: keep\nValue: 7'));
 const before=f.content();assert.equal(await f.writer.writeTaskFields(current.operonId,p.payload,{mode:'merge',reindex:'none',...(format==='inline'?{inlinePropertyDraft:p.inlinePropertyDraft}:{filePropertyDraft:p.filePropertyDraft})}),false);assert.equal(f.content(),before);assert.equal(f.writes(),0);f.native.dispose();
});
for(const format of ['inline','yaml'] as const)test(`${format} guarded terminal renderer preserves typed values and checks CAS`,async()=>{
 const f=await fixture(format,'list'),current=f.current();const pipeline=f.s.pipelines[0],status=pipeline.statuses.find(s=>s.isFinished)!;
 const p=planned(buildKanbanCellPlan({axes:{version:1,columns:{kind:'status',pipelineId:pipeline.id},swimlanes:axis('Value','list','native')},target:{columns:{kind:'status',pipelineId:pipeline.id,id:status.id},swimlanes:value('semi;colon')},task:current,access:createKanbanPropertyAccess(f.s,f.native),settings:f.s}));
 for(const change of p.inlinePropertyDraft)f.s.inlinePropertyDefinitions=retainInlinePropertyDefinition(f.s.inlinePropertyDefinitions,{sourceName:change.sourceName,type:change.type,encoding:'vault-v1'});
 const input={operonId:current.operonId,format,fieldValues:p.payload,expectedFieldValues:p.expectedFieldValues,...(format==='inline'?{inlinePropertyDraft:p.inlinePropertyDraft}:{filePropertyDraft:p.filePropertyDraft})};
 const rendered=f.writer.renderGuardedTaskSourceContent('Notes.md',f.content(),[input]);assert.equal(rendered.ok,true);assert.equal(f.writes(),0);
 if(format==='yaml')assert.deepEqual(readFileTaskPropertyDocument(rendered.content)?.frontmatter.Value,['semi;colon']);
 else assert.deepEqual(readInlinePropertyProjection(rendered.content.split('\n')[3],'Notes.md',{Value:'list'},f.s.keyMappings,f.s.inlinePropertyDefinitions)?.properties[0].value,['semi;colon']);
 assert.equal(f.writer.renderGuardedTaskSourceContent('Notes.md',rendered.content,[input]).ok,false);f.native.dispose();
});
test('high membership task still produces one merged list requirement, never cell products',()=>{
 const f=setup(axis('tags','list'),axis('tags','list'),value('new-one'),value('new-two'),task({},Array.from({length:500},(_,i)=>'tag'+i)));
 let reads=0;const original=f.input.access;f.input.access={...original,read:(...args)=>{reads++;return original.read(...args);}};
 const p=planned(buildKanbanCellPlan(f.input));assert.equal(reads,1);assert.equal(p.requirements.length,1);assert.equal(p.nextDraft.tags.length,502);
});
test('legacy cell adapter retains status identity and priority ID',()=>{
 const s=settings(),p=cloneDefaultKanbanPresets()[0];p.pipelineId=s.pipelines[0].id;p.swimlaneBy='priority';
 const result=resolveLegacyKanbanCellTarget(p,s.pipelines[0].statuses[0].id,s.priorities[0].label,s);assert.ok(result);assert.deepEqual(result.target.swimlanes,{kind:'priority',id:s.priorities[0].id});
});

for (const reverse of [false,true]) test(`status/date constraints are independent of axis order ${reverse}`,()=>{
 const s=settings(),pipeline=s.pipelines[0],open=pipeline.statuses.find(st=>!st.isFinished&&!st.isCancelled)!,done=pipeline.statuses.find(st=>st.isFinished)!;
 const statusAxis:KanbanAxis={kind:'status',pipelineId:pipeline.id};
 for (const alreadyOpen of [false,true]) {
  const current=task({status:`${pipeline.name}.${alreadyOpen?open.label:done.label}`});
  const date=axis('dateCompleted','date'), statusValue:KanbanAxisValue={kind:'status',pipelineId:pipeline.id,id:open.id};
  const plan=buildKanbanCellPlan({axes:{version:1,columns:reverse?date:statusAxis,swimlanes:reverse?statusAxis:date},target:{columns:reverse?value('2026-10-26'):statusValue,swimlanes:reverse?statusValue:value('2026-10-26')},task:current,settings:s,access:createKanbanPropertyAccess(s,fakeNative)});
  assert.equal(plan.state,'blocked');
 }
 const current=task({status:`${pipeline.name}.${open.label}`});
 const date=axis('dateCompleted','date'),statusValue:KanbanAxisValue={kind:'status',pipelineId:pipeline.id,id:done.id};
 const plan=planned(buildKanbanCellPlan({axes:{version:1,columns:reverse?date:statusAxis,swimlanes:reverse?statusAxis:date},target:{columns:reverse?value('2026-10-26'):statusValue,swimlanes:reverse?statusValue:value('2026-10-26')},task:current,settings:s,access:createKanbanPropertyAccess(s,fakeNative)}));
 assert.equal(plan.payload.dateCompleted,'2026-10-26');
});
test('typed List legacy lane adapter preserves number, numeric text, separators and whitespace',()=>{
 const s=settings(); const mapping:KeyMapping={canonicalKey:'customLabels',visiblePropertyName:'Labels',type:'list',isSystem:false,sync:'yes',enabled:true,showInKanbanSwimlane:true};s.keyMappings.push(mapping);
 s.inlinePropertyDefinitions=retainInlinePropertyDefinition(s.inlinePropertyDefinitions,{sourceName:'Labels',type:'list',encoding:'vault-v1'});
 const preset={...cloneDefaultKanbanPresets()[0],pipelineId:s.pipelines[0].id,swimlaneBy:'customLabels' as const};
 const members=[3,'3','two;three',' space ','quote"'];
 const keys=kanbanListLaneKeys(encodeVaultPropertyValue(members,'list'),true);
 assert.equal(new Set(keys).size,members.length);
 for(let i=0;i<keys.length;i++) assert.deepEqual(resolveLegacyKanbanCellTarget(preset,s.pipelines[0].statuses[0].id,keys[i],s)?.target.swimlanes,value(members[i]));
});
for (const native of [false,true]) test(`rename plus ${native?'native':'managed'} source uses one write with delayed index`,async()=>{
 const f=await fixture('yaml','number'),current=f.current();
 const expected=current.description;assert.equal(expected,'Notes');
 await f.writer.runExclusiveTaskMutation(async permit=>{
  f.file.path='Renamed.md';f.file.basename='Renamed';
  const sourceTask={...current,description:'Renamed',primary:{...current.primary,filePath:f.file.path}};
  assert.equal(await f.writer.writeTaskFields(current.operonId,{_description:'Renamed',note:'joined',datetimeModified:'2026-10-27T12:00:00'},
   {mutationPermit:permit,sourceTask,sourcePathBeforeRename:'Notes.md',reindex:'none',touchAncestors:false,mode:'merge',expectedFieldValues:{_description:'Renamed',note:''},
   ...(native?{filePropertyDraft:{changes:[{propertyName:'Value',nativeType:'number',value:7,expected:{present:false,value:undefined}}]}}:{})}),true);
 });
 assert.equal(f.writes(),1);assert.ok(f.content().includes('note: joined'));if(native)assert.ok(f.content().includes('Value: 7'));f.native.dispose();
});
function renameFixture() {
 let path='Old.md',content='before',occupied=false,renames=0,reads=0;
 const ports:TaskSourceRenamePorts={previousPath:'Old.md',candidatePath:'New.md',currentPath:()=>path,owns:p=>p===path,occupied:p=>p===path||occupied,
  read:async()=>{reads++;return content;},rename:async p=>{renames++;path=p;},canCommit:()=>true,validate:s=>s==='before',validateCommitted:s=>s==='after',
  commit:async rename=>{if(!await rename())return false;content='after';return true;}};
 return {ports,path:()=>path,content:()=>content,put:(s:string)=>{content=s;},occupy:()=>{occupied=true;},renames:()=>renames,reads:()=>reads};
}
test('filename transaction combines one rename and one source commit',async()=>{const f=renameFixture();assert.equal(await executeTaskSourceRenameTransaction(f.ports),true);assert.equal(f.path(),'New.md');assert.equal(f.renames(),1);});
test('filename conflict or rejected domain plan writes nothing',async()=>{for(const conflict of [true,false]){const f=renameFixture();if(conflict)f.occupy();else f.ports.commit=async()=>false;assert.equal(await executeTaskSourceRenameTransaction(f.ports),false);assert.equal(f.renames(),0);}});
test('source CAS failure before rename preserves the competing edit',async()=>{const f=renameFixture();f.ports.commit=async rename=>{f.put('external');return rename();};assert.equal(await executeTaskSourceRenameTransaction(f.ports),false);assert.equal(f.renames(),0);assert.equal(f.content(),'external');});
test('failed primary write rolls back only exact preimage filename',async()=>{const f=renameFixture();f.ports.commit=async rename=>{await rename();return false;};assert.equal(await executeTaskSourceRenameTransaction(f.ports),false);assert.equal(f.path(),'Old.md');assert.equal(f.renames(),2);});
test('rename rejection after apply is acknowledged without replay',async()=>{const f=renameFixture(),rename=f.ports.rename;f.ports.rename=async p=>{await rename(p);throw Error('after apply');};assert.equal(await executeTaskSourceRenameTransaction(f.ports),true);assert.equal(f.renames(),1);});
test('changed content and occupied rollback paths remain uncertain, never overwritten',async()=>{for(const collision of [false,true]){const f=renameFixture();f.ports.commit=async rename=>{await rename();if(collision)f.occupy();else f.put('external');return false;};await assert.rejects(executeTaskSourceRenameTransaction(f.ports),TaskSourceRenameUncertainError);assert.equal(f.renames(),1);assert.equal(f.path(),'New.md');}});
test('final read failure after commit is explicitly uncertain',async()=>{const f=renameFixture(),read=f.ports.read;f.ports.read=async()=>{if(f.content()==='after')throw Error('I/O');return read();};await assert.rejects(executeTaskSourceRenameTransaction(f.ports),TaskSourceRenameUncertainError);assert.equal(f.path(),'New.md');assert.equal(f.content(),'after');assert.equal(f.renames(),1);});
test('file description creation seed is the actual description, not a native property',()=>{const f=setup(axis('description'),axis('tags','list'),value('New task'),value('book'));const p=planned(buildKanbanCellPlan(f.input));assert.equal(p.nextDraft.description,'New task');});

const ts=createRequire(`${process.cwd()}/package.json`)('typescript') as typeof import('typescript');
const ast=ts.createSourceFile('main.ts',readFileSync('main.ts','utf8'),ts.ScriptTarget.Latest,true);
function integration(names:string[],dependencies:Record<string,unknown>) {
 const methods:string[]=[];ast.forEachChild(node=>{if(ts.isClassDeclaration(node))for(const member of node.members)if(member.name&&names.includes(member.name.getText(ast)))methods.push(member.getText(ast));});
 assert.equal(methods.length,names.length);
 const code=ts.transpileModule(`class Probe {${methods.join('\n')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 return new (Function(...Object.keys(dependencies),`${code};return Probe;`)(...Object.values(dependencies)))();
}
for(const mode of ['native-only','rename-native','rename-recurring','recurrence-conflict'] as const)test(`real Plugin primary transaction ${mode}`,{timeout:3000},async()=>{
 const f=await fixture('yaml','number');let aggregates=0,relations=0,renames=0;
 if(mode.includes('recurr')||mode==='recurrence-conflict') {f.put(f.content().replace('Unrelated: keep','Unrelated: keep\nrepeat: mode=done|freq=day|interval=1\nrepeatSeriesId: series1'));await f.refresh();}
 const original=f.current();
 f.app.vault.modify=async(file:TFile,content:string)=>{await f.app.vault.process(file,()=>content);};
 f.app.fileManager={renameFile:async(file:TFile,path:string)=>{renames++;file.path=path;file.basename=path.slice(0,-3);}} as App['fileManager'];
 f.indexer.reindexFilePath=async()=>{await f.refresh();};
 const probe=integration(['updateTaskFieldsAndRefresh','commitFileTerminalRecurrenceMutation'],{TFile,executeTaskSourceRenameTransaction,TaskSourceRenameUncertainError,scanFileWithMappings,parseFrontmatterDocument,executeFileRecurrenceTerminalTransaction,
  normalizeRepeatIdentityPayload:()=>{},enginePerfNow:()=>0,localNow:()=> '2026-10-27T12:00:00',generateOperonId:()=> 'new1234'});
 Object.assign(probe,{app:f.app,indexer:{...f.indexer,getTask:(id:string)=>id==='abc1234'?f.current():undefined},writer:f.writer,settings:f.s,storage:{repeatSeries:{getAllSeriesIds:()=>[]}},
  redirectDuplicateOperonIdAction:()=>false,inheritFieldsOnParentLink:async(_task:IndexedTask,p:Record<string,string>)=>p,applyFieldRulesToTaskPayload:(_task:IndexedTask,p:Record<string,string>)=>p,
  ensureRepeatSeriesIdPayload:()=>{},applyDerivedRepeatFieldsToPayload:async()=>{},validateDependencyPayloadChanges:()=>true,guardTaskStatusChangeOrShow:async()=>true,
  maybeApplyPeriodicNoteParentRealignmentToPayload:async()=>{},getParentLinkExpectedFields:()=>undefined,setStatusCyclePerfChangedKeys:()=>{},logStatusCyclePerfStage:()=>{},
  commitInlineTerminalRecurrenceMutation:async()=>({outcome:'not-applicable'}),createStatusCycleIndexPerfContext:()=>undefined,
  syncDependencyPayloadChanges:async()=>{await f.writer.runExclusiveTaskMutation(async()=>{relations++;});},syncRepeatSeriesEntryIfNeeded:async()=>{},applyInlineRepeatCompletionModeIfRequested:async()=>{},
  maybeCreateRecurringOccurrence:async()=>({created:false}),resolveAfterTaskForRecurrenceMaterialization:(t:IndexedTask)=>t,
  refreshAggregateTotalsAfterTaskMutation:async(_before:IndexedTask,_after:IndexedTask,o:{modifiedTimestamp:string})=>{assert.ok(o.modifiedTimestamp);await f.writer.runExclusiveTaskMutation(async()=>{aggregates++;});},
  scheduleProjectSerialIndexReconcile:()=>{},refreshViews:()=>{},sanitizeTaskFileName:(s:string)=>s.replace(/[\\/:*?"<>|]/g,'').trim(),resolveCompletionTimestamp:()=> '2026-10-27T12:00:00',
  recurrenceService:{planTerminalRecurrenceTransition:()=>mode==='recurrence-conflict'?{disposition:'materialize-file',preview:{sourceTaskFinalFilePath:'Archive.md'}}:{disposition:'series-ended',preview:{seriesId:'series1'}}},
  settleFileTerminalRecurrenceCommit:async()=>{await f.refresh();return f.current();},
 });
 const p=planned(buildKanbanCellPlan({axes:{version:1,columns:axis('Value','number','native'),swimlanes:mode==='native-only'?null:axis('description')},
  target:{columns:value(0),swimlanes:mode==='native-only'?null:value('Renamed')},task:original,settings:f.s,access:createKanbanPropertyAccess(f.s,f.native)}));
 const payload={...p.payload,...(mode==='rename-recurring'||mode==='recurrence-conflict'?{status:`${f.s.pipelines[0].name}.${f.s.pipelines[0].statuses.find(st=>st.isFinished)!.label}`,_checkbox:'done',dateCompleted:'2026-10-27'}:{})};
 const result=await probe.updateTaskFieldsAndRefresh(original.operonId,payload,{filePropertyDraft:p.filePropertyDraft,expectedFieldValues:p.expectedFieldValues,canCommit:()=>true});
 assert.equal(result,mode!=='recurrence-conflict');
 if(mode==='recurrence-conflict'){assert.equal(f.writes(),0);assert.equal(renames,0);}
 else {assert.equal(f.writes(),1);assert.equal(renames,mode==='native-only'?0:1);assert.equal(aggregates,1);assert.equal(relations,1);assert.equal(f.current().fieldValues.datetimeModified,'2026-10-27T12:00:00');assert.ok(f.content().includes('Value: 0'));}
 f.native.dispose();
});
test('Prepared Creator keeps typed cell seeds and explicit empty over defaults, then respects user edits',()=>{
 const s=settings();let submits=0;
 const ui=new PreparedTaskCreatorDraft({properties:{keyMappings:s.keyMappings,propertyTypes:{Values:'multitext',Count:'number'}},
  seeds:{defaults:[{sourceName:'priority',value:'High'},{sourceName:'Count',value:20}],...splitKanbanCreatorSeeds([{sourceName:'priority',value:''},{sourceName:'Count',value:0},{sourceName:'Values',value:['semi;colon','3',3]}])},
  readTemplate:async()=>'',clock:()=>({now:'2026-10-27T12:00:00'}),parent:()=>null,candidates:()=>[],onSubmit:()=>{submits++;return true;}},s);
 assert.equal(ui.field('priority').value,'');assert.equal(ui.field('Count').value,0);assert.deepEqual(ui.field('Values').value,['semi;colon','3',3]);
 ui.draft.setValue('Count',7);const result=ui.submission('inline','User title','keep-completed');assert.equal(result.description,'User title');assert.equal(result.snapshot.fields.find(f=>f.property.sourceName==='Count')?.value,7);
 ui.close();assert.equal(submits,0);
});

test('additive list optimism retains source position and unique totals; only target manual order is persisted',()=>{
 const s=settings(),pipeline=s.pipelines[0],status=pipeline.statuses[0];
 const a=task({status:`${pipeline.name}.${status.label}`},['book']),b={...task({status:`${pipeline.name}.${status.label}`},['book','action']),operonId:'xyz1234'};
 const preset={...cloneDefaultKanbanPresets()[0],pipelineId:pipeline.id,swimlaneBy:'tags' as const,sortMode:'manual' as const};
 const source=buildKanbanCellKey(status.id,'book'),target=buildKanbanCellKey(status.id,'action');
 const order={[source]:[b.operonId,a.operonId],[target]:[b.operonId]};
 const board=queryKanbanBoard({preset,pipeline,pipelines:s.pipelines,filterSet:null,tasks:[a,b],priorities:s.priorities,keyMappings:s.keyMappings,manualOrder:order});
 const context={taskId:a.operonId,sourceStatusId:status.id,sourceLaneKey:'book',targetStatusId:status.id,targetLaneKey:'action',swimlaneBy:'tags' as const,targetBeforeTaskId:b.operonId};
 const probe=integration(['buildKanbanManualDropOrderCells','insertKanbanTaskIdBefore'],{buildKanbanCellKey});
 Object.assign(probe,{storage:{kanbanOrder:{getBoard:()=>order}},queryKanbanBoardForOrder:()=>({...board,getCellTasks:(c:string,r:string)=>board.cellMap.get(buildKanbanCellKey(c,r))??[]})});
 const records=probe.buildKanbanManualDropOrderCells(preset,context,true,true,true);
 assert.deepEqual(Object.keys(records.nextCells),[target]);assert.deepEqual(records.nextCells[target],[a.operonId,b.operonId]);assert.deepEqual(order[source],[b.operonId,a.operonId]);
 const move=createKanbanDropOptimisticMove(context,{task:a,keyMappings:s.keyMappings,priorities:s.priorities});
 applyKanbanOptimisticMovesToBoard(board,s.priorities,[move],s.keyMappings);
 assert.deepEqual(board.cellMap.get(source)?.map(t=>t.operonId),[b.operonId,a.operonId]);assert.deepEqual(board.cellMap.get(target)?.map(t=>t.operonId),[a.operonId,b.operonId]);
 assert.equal(board.cellCountMap.get(source),2);assert.equal(board.cellCountMap.get(target),2);assert.equal(board.columns.find(c=>c.statusId===status.id)?.count,2);
 const noop=setup(axis('tags','list'),null,value('book'),null,a);assert.equal(planned(buildKanbanCellPlan(noop.input)).state,'noop');
});
for (const pending of [true,false]) test(`unreadable native field never clears a task (${pending?'pending':'conflict'})`,()=>{
 const s=settings(),reference=axis('Value','number','native');
 const access=createKanbanPropertyAccess(s,{...fakeNative,getTypes:()=>({Value:'number'}),isReady:()=>!pending,getTask:()=>({available:false,revision:'1',properties:new Map()})});
 const result=buildKanbanCellPlan({axes:{version:1,columns:reference,swimlanes:null},target:{columns:empty,swimlanes:null},task:task(),settings:s,access});assert.equal(result.state,'blocked');
});
test('canonical/native aliases collapse to one scalar requirement and one payload',()=>{
 const s=settings(),mapping=s.keyMappings.find(m=>m.canonicalKey==='note')!;
 const result=planned(buildKanbanCellPlan({axes:{version:1,columns:axis('note'),swimlanes:axis(mapping.visiblePropertyName,'text','native')},target:{columns:value('new'),swimlanes:value('new')},task:task(),settings:s,access:createKanbanPropertyAccess(s,fakeNative)}));
 assert.deepEqual(result.payload,{note:'new'});assert.equal(result.requirements.length,1);
});

test('cell writer refuses a moved source, changed format, removed property and stale board before commit',()=>{
 const f=setup(axis('note'),null,value('new'),null,task()),p=planned(buildKanbanCellPlan(f.input));let current=f.input.task,boardValid=true;
 const probe=integration(['kanbanCellWriteOptions'],{createKanbanPropertyAccess,getNativePropertyIndex:()=>fakeNative,kanbanPayloadMatchesPlan});
 Object.assign(probe,{settings:f.s,indexer:{getTask:()=>current},app:{}});
 const options=probe.kanbanCellWriteOptions(p,current,()=>boardValid);assert.equal(options.canCommit(),true);
 current={...current!,primary:{...current!.primary,filePath:'Other.md'}};assert.equal(options.canCommit(),false);
 current={...f.input.task!,primary:{...f.input.task!.primary,format:'yaml'}};assert.equal(options.canCommit(),false);
 current=f.input.task;boardValid=false;assert.equal(options.canCommit(),false);boardValid=true;
 f.s.keyMappings.push({canonicalKey:'note',visiblePropertyName:'Ambiguous',type:'number',sync:'yes',enabled:true,isSystem:false});assert.equal(options.canCommit(),false);
});


test('legacy list lanes preserve literal backslashes, escaped separators and Unicode without double escaping',()=>{
 const raw=String.raw`C:\Work; A\; B`,lane=String.raw`猫\;new`;
 const encoded=addKanbanListLane(raw,lane,false);
 assert.deepEqual(parseListValue(encoded),[String.raw`C:\Work`,'A; B',lane]);
 assert.equal(addKanbanListLane(encoded,lane,false),encoded);
 assert.deepEqual(parseListValue(addKanbanListLane('First','Last\\',false)),['First','Last\\']);
 assert.throws(()=>addKanbanListLane('Last\\','Added',false),/cannot be represented losslessly/);
});

test('typed list lanes retain their own codec and numeric identities',()=>{
 const original=encodeVaultPropertyValue([String.raw`C:\Work`,'semi;colon',0,'0'],'list');
 const added=encodeVaultPropertyValue(['Last\\'],'list');
 const encoded=addKanbanListLane(original,added,true);
 assert.deepEqual(kanbanListLaneKeys(encoded,true),[String.raw`C:\Work`,'semi;colon',0,'0','Last\\'].map(v=>encodeVaultPropertyValue([v],'list')));
 assert.equal(addKanbanListLane(encoded,added,true),encoded);
});

for(const key of ['contexts','assignees'] as const){
 test(`${key} cell planning and writeback preserve legacy member boundaries`,()=>{
  const s=settings(),pipeline=s.pipelines[0],status=pipeline.statuses[0];
  const original=task({status:`${pipeline.name}.${status.label}`,[key]:String.raw`C:\Work; A\; B`});
  const before=structuredClone(original),lane=String.raw`猫\;new`;
  const expected=[String.raw`C:\Work`,'A; B',lane];
  const p=planned(buildKanbanCellPlan(setup(axis(key,'list'),null,value(lane),null,original).input));
  const writeback=buildKanbanWritebackPlan({task:original,pipeline,targetStatus:status,sourceLaneKey:'A; B',targetLaneKey:lane,swimlaneBy:key,keyMappings:s.keyMappings});
  assert.deepEqual(parseListValue(p.payload[key]),expected);
  assert.deepEqual(parseListValue(writeback.payload[key]),expected);
  const preset={...cloneDefaultKanbanPresets()[0],pipelineId:pipeline.id,swimlaneBy:key};
  const board=queryKanbanBoard({preset,pipeline,pipelines:s.pipelines,filterSet:null,tasks:[original],priorities:s.priorities,keyMappings:s.keyMappings});
  const move=createKanbanDropOptimisticMove({taskId:original.operonId,sourceStatusId:status.id,sourceLaneKey:'A; B',targetStatusId:status.id,targetLaneKey:lane,swimlaneBy:key,targetBeforeTaskId:null},{task:original,keyMappings:s.keyMappings});
  assert.deepEqual(new Set(move.targetLaneKeys),new Set(expected));
  assert.equal(buildOptimisticMovedTask(original,move,board,s.keyMappings).fieldValues[key],writeback.payload[key]);
  assert.deepEqual(original,before);
 });

 test(`${key} rejects an unrepresentable boundary before mutating optimistic cards or totals`,()=>{
  const s=settings(),pipeline=s.pipelines[0],status=pipeline.statuses[0];
  const original=task({status:`${pipeline.name}.${status.label}`,[key]:'Last\\'}),before=structuredClone(original);
  const result=buildKanbanCellPlan(setup(axis(key,'list'),null,value('Added'),null,original).input);
  assert.deepEqual(result,{state:'blocked',reason:'unrepresentable-legacy-list'});
  assert.throws(()=>buildKanbanWritebackPlan({task:original,pipeline,targetStatus:status,sourceLaneKey:'Last\\',targetLaneKey:'Added',swimlaneBy:key,keyMappings:s.keyMappings}),/cannot be represented losslessly/);
  const preset={...cloneDefaultKanbanPresets()[0],pipelineId:pipeline.id,swimlaneBy:key};
  const board=queryKanbanBoard({preset,pipeline,pipelines:s.pipelines,filterSet:null,tasks:[original],priorities:s.priorities,keyMappings:s.keyMappings});
  const boardBefore=structuredClone({cells:board.cellMap,counts:board.cellCountMap,columns:board.columns,lanes:board.lanes});
  const move=createKanbanDropOptimisticMove({taskId:original.operonId,sourceStatusId:status.id,sourceLaneKey:'Last\\',targetStatusId:status.id,targetLaneKey:'Added',swimlaneBy:key,targetBeforeTaskId:null});
  assert.throws(()=>applyKanbanOptimisticMovesToBoard(board,s.priorities,[move],s.keyMappings),/cannot be represented losslessly/);
  assert.deepEqual({cells:board.cellMap,counts:board.cellCountMap,columns:board.columns,lanes:board.lanes},boardBefore);
  assert.deepEqual(original,before);
 });
}
