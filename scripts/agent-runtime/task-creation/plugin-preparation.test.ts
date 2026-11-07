import {validate} from './extension.test';
import {buildLivePropertyCatalogV1} from '../../../src/agent-runtime/runtime/catalog-builder';
import assert from 'node:assert/strict';
import test from 'node:test';
import {Host} from 'operon-creation-plugin-host-fixture';
import {DEFAULT_SETTINGS} from '../../../src/types/settings';
import {buildTaskCreationPolicyV1} from '../../../src/agent-runtime/extensions/task-creation-v1/policy';
import {prepareRuntimeTaskCreationV1,type RuntimeTaskCreationAdapterPortsV1} from '../../../src/agent-runtime/runtime/task-creation-adapter';
import {sha256HexV1} from '../../../src/agent-runtime/contracts/v1/canonical';
import {decodeRoutedTaskCreationPlanV1} from '../../../src/agent-runtime/extensions/task-creation-v1/decode';
import type {GraphTransactionJournalStepV1} from '../../../src/agent-runtime/runtime/receipts/graph-transaction-journal';
import {executionFixture} from './execution.test';
const now='2026-11-07T12:00:00.000Z';
function fixture(templateContent:string|null=null,periodic=false,container=false) {
 const settings=structuredClone(DEFAULT_SETTINGS);settings.inlineTaskSaveMode='specific-file';settings.inlineTaskTargetFile='Tasks.md';
 const catalog=()=>{const built=buildLivePropertyCatalogV1(settings);if(!built.ok)throw new Error('Invalid test catalog');return built.value;};
 const templates=templateContent===null?[]:[{id:'test-template',name:'Test',kind:'folder' as const,path:'Templates/Test.md'}];
 const config=(kind:'daily'|'weekly')=>({kind,source:'operon' as const,format:kind==='daily'?'YYYY-MM-DD':'GGGG-[W]WW',folder:kind==='daily'?'Daily':'Weekly',template:'',createAsOperonTask:container});
 const resolution=(kind:'daily'|'weekly')=>periodic?{available:true as const,config:config(kind)}:{available:false as const,reason:'operon-disabled' as const};
 const policy=()=>buildTaskCreationPolicyV1(settings,templates,resolution('daily'),resolution('weekly'));
 const files=new Map([['Tasks.md','# Tasks\n']]);
 const ports:RuntimeTaskCreationAdapterPortsV1={settings:()=>settings,listOperonIds:()=>new Set(),listDependencyGraphTasks:()=>[],getExistingTask:()=>null,readSource:async filePath=>({filePath,content:files.get(filePath)??null}),resolveConfiguredInlineTarget:async()=>({filePath:'Tasks.md',placement:{kind:'append'}}),resolveConfiguredFilePath:async title=>title+'.md',readTemplate:async()=>templateContent===null?null:{templateId:'test-template',content:templateContent,revision:sha256HexV1(templateContent)},creationFieldCatalog:()=>catalog().fields,resolveCoreTemplateVariables:content=>content,generateOperonId:()=> 'new0001',now:()=>now.slice(0,19)};
 const host=new Host({settings,app:{native:{ensure:async()=>{},typesAvailable:()=>true,getTypes:()=>({score:'number',ref:'text'})}},indexer:{getTaskSnapshot:()=>null,getAllOperonIds:()=>new Set(),getFileTaskByPath:()=>null,getAllTasks:()=>[],hasDuplicateOperonIdConflict:()=>false},storage:{getCommittedInlinePropertyDefinitions:()=>undefined,periodicNoteContainers:{isHealthy:()=>true},repeatSeries:{getAllSeriesIds:()=>new Set(),getRevision:()=>0}},readTaskCreationPolicySource:async()=>policy(),readAgentRuntimeCreationTemplate:ports.readTemplate,readAgentRuntimeMutationSource:ports.readSource,resolveEffectivePeriodicNoteConfig:async(kind:'daily'|'weekly')=>resolution(kind),resolveWeeklyNoteDailyDateHeading:async(date:string)=>date,getAgentRuntimeCatalogBuild:()=>({ok:true}),requireAgentRuntimeCatalogProjection:catalog,getPeriodicNoteService:()=>({prepareAt:async({kind,dateKey}:{kind:'daily'|'weekly';dateKey:string})=>{const path=(kind==='daily'?'Daily':'Weekly')+'/'+dateKey+'.md';return files.has(path)?{status:'existing',result:{path}}:{status:'prepared',plan:{path,content:(container?'---\noperonId: parent1\n---\n':'')+'# Periodic note\n',templatePath:null,mode:'plain'}};}}),resolveAgentRuntimeFileCreationPath:ports.resolveConfiguredFilePath,
  prepareAgentRuntimeIdentityCreation:async(requestId:string,spec:Parameters<typeof prepareRuntimeTaskCreationV1>[1],effectiveAt:string,ids:ReadonlyMap<string,string>|undefined,active:ReadonlySet<string>|undefined,series:ReadonlyMap<string,string>|undefined,allocations:Parameters<typeof prepareRuntimeTaskCreationV1>[7],options:Partial<RuntimeTaskCreationAdapterPortsV1>)=>prepareRuntimeTaskCreationV1(requestId,spec,{...ports,...options},ids,effectiveAt.slice(0,19),active,series,allocations),
  prepareAgentRuntimeIdentityGraphSteps:async(prepared:Extract<Awaited<ReturnType<typeof prepareRuntimeTaskCreationV1>>,{ok:true}>)=>({ok:true,steps:prepared.plan.sourceGroups.map(group=>{const state=(content:string|null)=>({state:content===null?'absent' as const:'present' as const,content,digest:sha256HexV1(content??'')});return {stepId:'source:'+group.filePath,groupId:'task-source:'+group.filePath,resourceKind:'task-source',resourceKey:group.filePath,operation:group.expectedContent===null?'create':'modify',before:state(group.expectedContent),after:state(group.resultingContent)} as GraphTransactionJournalStepV1;})}),
 });
 const f=executionFixture();f.request.spec.item={itemRef:'one',title:'Review Q3',fields:[],target:{mode:'configured-default',representation:'inline'},template:templateContent===null?{mode:'none'}:{mode:'selected',templateId:'test-template'}};
 return {host,settings,request:f.request,revision:f.plan.contextRevision,files};
}
test('Plugin routed inline preview is zero-write and seals typed definitions before its task source',async()=>{
 const f=fixture('---\nscore: 7\n---\nNever copy');const before=[...f.files];
 const prepared=await f.host.prepareRoutedRuntimeCreation(f.request,now);
 assert.equal(prepared.steps[0].resourceKind,'inline-property-definitions');assert.equal(prepared.steps[1].resourceKind,'task-source');assert.deepEqual([...f.files],before);
 const plan=f.host.buildRoutedRuntimeCreationPlan(f.request,prepared,f.revision,now,'routed-plan');assert.ok(decodeRoutedTaskCreationPlanV1(plan).ok);assert.ok(validate('sealedPlan',plan));
 const repeated=await f.host.prepareRoutedRuntimeCreation(f.request,now,plan);assert.deepEqual(repeated,prepared);
});
test('Plugin honors exact File target with display title disabled and native File template references',async()=>{
 const f=fixture('---\nref: "{{operonIdA}}"\n---\n- [ ] Child {{operonId:: {{operonIdA}} }}');
 f.request.spec.item.target={mode:'exact-path',representation:'file',filePath:'Chosen file.md'};
 const prepared=await f.host.prepareRoutedRuntimeCreation(f.request,now);
 assert.equal(prepared.preparation.plan.tasks[0].filePath,'Chosen file.md');assert.equal(prepared.steps.length,1);
 const plan=f.host.buildRoutedRuntimeCreationPlan(f.request,prepared,f.revision,now,'routed-file');assert.ok(decodeRoutedTaskCreationPlanV1(plan).ok);assert.ok(validate('sealedPlan',plan));
 assert.deepEqual(await f.host.prepareRoutedRuntimeCreation(f.request,now,plan),prepared);
 const id=plan.creation.allocations[0];const content=prepared.steps[0].after.content!;assert.ok(content.includes('ref: '+id));assert.ok(content.includes('operonId:: '+id));
});
test('Plugin binding changes when native types, selected template or source changes',async()=>{
 const f=fixture('---\nscore: 7\n---\n');const prepared=await f.host.prepareRoutedRuntimeCreation(f.request,now);const plan=f.host.buildRoutedRuntimeCreationPlan(f.request,prepared,f.revision,now,'routed-bindings');
 f.files.set('Tasks.md','# Tasks\nChanged source\n');const changed=await f.host.prepareRoutedRuntimeCreation(f.request,now,plan);assert.notEqual(changed.creation.graphDigest,plan.creation.graphDigest);
});

test('Plugin recovery binds the exact approved source and definition journal steps',async()=>{
 const f=fixture('---\nscore: 7\n---\n');const prepared=await f.host.prepareRoutedRuntimeCreation(f.request,now);const plan=f.host.buildRoutedRuntimeCreationPlan(f.request,prepared,f.revision,now,'routed-journal');
 const journal={vaultIdentityHash:'vault',clientInstanceId:plan.clientInstanceId,idempotencyKeyHash:plan.idempotencyKeyHash,mutationKind:plan.mutationKind,planId:plan.planId,planHash:plan.planHash,targetDigest:plan.receiptTargetDigest,steps:prepared.steps};
 assert.equal(f.host.agentRuntimeIdentityJournalMatchesPlan(journal,plan,'vault'),true);
 for(const index of [0,1]) {const changed=structuredClone(journal);changed.steps[index].after.content+=' ';changed.steps[index].after.digest=sha256HexV1(changed.steps[index].after.content!);assert.equal(f.host.agentRuntimeIdentityJournalMatchesPlan(changed,plan,'vault'),false);}
 assert.equal(f.host.agentRuntimeIdentityJournalMatchesPlan({...journal,phase:'compensating',completedStepCount:1},plan,'vault'),true);
});

for(const kind of ['daily','weekly'] as const) test(`Plugin ${kind} route uses inline template dates and seals existing/new note preparation`,async()=>{
 const f=fixture('---\ndateScheduled: 2026-12-31\nscore: 7\n---\nDo not copy inline body',true);
 f.request.spec.item.target={mode:'periodic-note',representation:'inline',periodicKind:kind};
 const before=structuredClone(f.request);const prepared=await f.host.prepareRoutedRuntimeCreation(f.request,now);assert.deepEqual(f.request,before);
 assert.equal(prepared.creation.periodicRoute?.routeDateKey,'2026-12-31');assert.equal(prepared.creation.periodicRoute?.routeSource,'date-scheduled');
 assert.ok(prepared.steps.at(-1)!.after.content!.startsWith('# Periodic note'));assert.ok(!prepared.steps.at(-1)!.after.content!.includes('Do not copy'));
 const plan=f.host.buildRoutedRuntimeCreationPlan(f.request,prepared,f.revision,now,'routed-'+kind);assert.ok(decodeRoutedTaskCreationPlanV1(plan).ok,JSON.stringify(plan));assert.ok(validate('sealedPlan',plan));
 assert.deepEqual(await f.host.prepareRoutedRuntimeCreation(f.request,now,plan),prepared);
 f.files.set(prepared.creation.periodicRoute!.notePath,'# Existing note\n');
 const existing=await f.host.prepareRoutedRuntimeCreation(f.request,now);assert.equal(existing.creation.periodicRoute?.noteExpectedState,'present');assert.ok(existing.steps.at(-1)!.after.content!.startsWith('# Existing note'));
});
test('Plugin explicit periodic date wins over template dates and unavailable configured target never falls back',async()=>{
 const f=fixture('---\ndateScheduled: 2026-12-31\n---\n',true);f.request.spec.item.target={mode:'periodic-note',representation:'inline',periodicKind:'daily',routeDate:'2027-01-02'};
 const prepared=await f.host.prepareRoutedRuntimeCreation(f.request,now);assert.equal(prepared.creation.periodicRoute?.routeDateKey,'2027-01-02');
 const unavailable=fixture();unavailable.settings.inlineTaskSaveMode='daily-notes';await assert.rejects(()=>unavailable.host.prepareRoutedRuntimeCreation(unavailable.request,now),/unavailable/);
});

async function executionHost() {
 const f=fixture('---\nscore: 7\n---\n');
 const prepared=await f.host.prepareRoutedRuntimeCreation(f.request,now);const plan=f.host.buildRoutedRuntimeCreationPlan(f.request,prepared,f.revision,now,'plugin-apply');
 let journal:import('../../../src/agent-runtime/runtime/receipts/graph-transaction-journal').GraphTransactionJournalV1|null=null;
 let receipt:import('../../../src/agent-runtime/contracts/v1/mutation').MutationReceiptV1|null=null;
 let definitions:import('../../../src/core/inline-property-definitions').InlinePropertyDefinitions|undefined;
 let sourceWrites=0, failSource=false;
 const definitionPorts={mappings:()=>f.settings.keyMappings,definitions:()=>definitions,register:async(entries:readonly import('../../../src/core/inline-property-definitions').InlinePropertyDefinition[],guard:()=>boolean)=>{assert.ok(guard());definitions={version:1,entries:[...entries]};}};
 Object.assign(f.host,{
  agentRuntimeVaultIdentityHash:'a'.repeat(64),sampleAgentRuntimeRevision:()=>({contextRevision:f.revision}),
  storage:{getCommittedInlinePropertyDefinitions:()=>definitions,registerRuntimeInlinePropertyDefinitions:definitionPorts.register,repeatSeries:{getRevision:()=>0}},
  agentRuntimeReceiptStore:{lookupForApplyAdmission:async()=>({health:{healthy:true},receipt,journal:structuredClone(journal)}),acquireJournal:async(value:typeof journal)=>{journal=structuredClone(value);return true;},claimJournal:async()=>true,persistJournal:async(value:typeof journal)=>{journal=structuredClone(value);},lookupJournal:async()=>structuredClone(journal),deleteJournal:async()=>{journal=null;return true;},finalizeReceipt:async(value:typeof receipt)=>{receipt=structuredClone(value);journal=null;}},
  readAgentRuntimeMutationSource:async(filePath:string)=>({filePath,content:f.files.get(filePath)??null}),
  applyAgentRuntimeIdentityGraphStep:async(step:GraphTransactionJournalStepV1,direction:'forward'|'reverse')=>{
   assert.ok(journal,'journal must precede every write');
   if(step.resourceKind==='inline-property-definitions')return direction==='forward'?applyCreationDefinitionStepV1(step,definitionPorts):verifyRetainedCreationDefinitionsV1(step,definitionPorts);
   if(failSource)throw new Error('Synthetic source write failure');
   const expected=direction==='forward'?step.before:step.after,next=direction==='forward'?step.after:step.before;
   if((f.files.get(step.resourceKey)??null)!==expected.content)return false;
   if(next.content===null)f.files.delete(step.resourceKey);else f.files.set(step.resourceKey,next.content);sourceWrites++;return true;
  },
  verifyAgentRuntimeIdentityPlanAfterState:async(_plan:unknown,steps?:GraphTransactionJournalStepV1[])=>!!steps&&steps.filter(s=>s.resourceKind==='task-source').every(s=>f.files.get(s.resourceKey)===s.after.content),
  indexer:{getTaskSnapshot:()=>null,getAllOperonIds:()=>new Set(),reindexAffectedSources:async()=>{}},awaitAgentRuntimeSettlement:async()=>{},reindexAgentRuntimeGraphCommittedPrefix:async()=>{},
 });
 const apply={...executionFixture().apply,plan,idempotencyKey:f.request.idempotencyKey};
 return {...f,plan,apply,definitions:()=>definitions,writes:()=>sourceWrites,journal:()=>journal,setFailure(value:boolean){failSource=value;},run:(recoveryOnly=false)=>f.host.applyAgentRuntimeIdentityCreation(apply,{recoveryOnly,dispatch:async()=>{}})};
}
import {applyCreationDefinitionStepV1,verifyRetainedCreationDefinitionsV1} from '../../../src/agent-runtime/extensions/task-creation-v1/definition-journal';
test('Plugin apply uses approved journal, registers definitions first and replays receipt without a second write',async()=>{
 const f=await executionHost();const result=await f.run();assert.equal(result.status,'applied',JSON.stringify(result));assert.equal(f.writes(),1);assert.equal(f.definitions()?.entries[0].sourceName,'score');assert.equal(f.journal(),null);
 assert.equal((await f.run()).status,'already-applied');assert.equal(f.writes(),1);
});
test('Plugin rejects changed settings or source before definition and task writes',async()=>{
 for(const change of ['settings','source'] as const){const f=await executionHost();if(change==='settings')f.settings.inlineTaskHeading='Changed';else f.files.set('Tasks.md','# Other\n');const result=await f.run();assert.equal(result.status,'failed');assert.equal(f.writes(),0);assert.equal(f.definitions(),undefined);assert.equal(f.journal(),null);}
});
test('Plugin partial native registration recovers the same journal while retaining its definitions',async()=>{
 const f=await executionHost();f.setFailure(true);assert.equal((await f.run()).status,'outcome-unknown');assert.ok(f.journal());assert.equal(f.writes(),0);assert.ok(f.definitions());
 f.setFailure(false);const recovered=await f.run(true);assert.equal(recovered.status,'applied',JSON.stringify(recovered));assert.equal(f.writes(),1);assert.equal(f.journal(),null);
});


test('Plugin periodic File Task container is an explicit sealed parent in the public preview',async()=>{
 const f=fixture(null,true,true);f.request.spec.item.target={mode:'periodic-note',representation:'inline',periodicKind:'daily',routeDate:'2026-12-31'};
 const prepared=await f.host.prepareRoutedRuntimeCreation(f.request,now);assert.equal(prepared.creation.periodicRoute?.container.operonId,'parent1');assert.equal(prepared.preparation.createEffects[0].resolvedParentOperonId,'parent1');
 const plan=f.host.buildRoutedRuntimeCreationPlan(f.request,prepared,f.revision,now,'periodic-container');assert.ok(decodeRoutedTaskCreationPlanV1(plan).ok,JSON.stringify(plan));assert.ok(validate('sealedPlan',plan));
});
test('Plugin configured File representation and selected/none templates remain explicit in the result',async()=>{
 const f=fixture('---\nscore: 7\n---\nBody');f.settings.taskCreatorDefaultToFileTask=true;f.settings.taskCreatorDefaultFileTemplateId='test-template';f.request.spec.item.target={mode:'configured-default'};f.request.spec.item.template={mode:'configured'};
 const selected=await f.host.prepareRoutedRuntimeCreation(f.request,now);assert.equal(selected.preparation.plan.tasks[0].representation,'file');assert.equal(selected.creation.templateId,'test-template');
 const plan=f.host.buildRoutedRuntimeCreationPlan(f.request,selected,f.revision,now,'configured-file');assert.ok(decodeRoutedTaskCreationPlanV1(plan).ok);assert.ok(validate('sealedPlan',plan));
 f.request.spec.item.template={mode:'none'};const none=await f.host.prepareRoutedRuntimeCreation(f.request,now);assert.equal(none.creation.templateId,null);assert.ok(!none.steps[0].after.content!.includes('Body'));assert.ok(!none.steps[0].after.content!.includes('score:'));
});
