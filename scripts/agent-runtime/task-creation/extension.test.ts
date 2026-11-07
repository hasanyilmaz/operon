import { structuredErrorV1 } from '../../../src/agent-runtime/contracts/v1/primitives';
import { canonicalJsonV1, sha256HexV1, toJsonValueV1 } from '../../../src/agent-runtime/contracts/v1/canonical';
import { decodeMutationApplyRequestV1 } from '../../../src/agent-runtime/contracts/v1/decode';
import { createOperonAgentRuntimeFacadeV1 } from '../../../src/agent-runtime/runtime/facade';
import { RuntimeLifecycleCoordinatorV1 } from '../../../src/agent-runtime/runtime/lifecycle';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import { DEFAULT_SETTINGS } from '../../../src/types/settings';
import { buildOperonPeriodicNoteConfig } from '../../../src/core/periodic-note-settings';
import { resolveEffectivePeriodicNoteConfig } from '../../../src/core/periodic-note-config';
import { buildTaskCreationPolicyV1 } from '../../../src/agent-runtime/extensions/task-creation-v1/policy';
import { createTaskCreationRuntimeV1 } from '../../../src/agent-runtime/extensions/task-creation-v1/gateway';
import { decodeTaskCreationPolicyRequestV1, decodeTaskCreationPolicyResultV1, decodeRoutedTaskCreationPreviewV1, decodeRoutedTaskCreationApplyV1, decodeRoutedTaskCreationPlanV1, decodeRoutedTaskCreationPreviewResultV1, decodeRoutedTaskCreationMutationResultV1 } from '../../../src/agent-runtime/extensions/task-creation-v1/decode';
import { taskCreationAdvertisementsV1, type TaskCreationPolicyRequestV1, type RoutedTaskCreationPreviewRequestV1 } from '../../../src/agent-runtime/extensions/task-creation-v1/contracts';
import { validateCliInvocationForTransportV1 } from '../../../src/agent-runtime/transport/invocation-validator';
import { getTaskCreationDeveloperApiV1 } from '../../../src/agent-runtime/extensions/task-creation-v1/developer-api';
import type { TaskWorkflowDeveloperApiRuntimeOptionsV1 } from '../../../src/agent-runtime/extensions/task-workflows-v1/developer-api';
import type { OperonAgentRuntimeCoreV1 } from '../../../src/agent-runtime/runtime/types';
import type { OperonDeveloperApiConsumerPluginV1 } from '../../../src/agent-runtime/public/v1/developer-api';
const request: TaskCreationPolicyRequestV1 = { contractVersion: 1, requestId: 'creation-policy-test', kind: 'task-creation-policy', consistency: 'live-verified' };
function fixture() {
 const settings = structuredClone(DEFAULT_SETTINGS);
 settings.inlineTaskSaveMode = 'weekly-notes'; settings.manageWeeklyNotesWithOperon = true;
 settings.weeklyNoteFolder = 'Weekly'; settings.defaultInlineTaskTemplateId = 'folder-file-task-template:Templates/Default.md';
 const policy = () => buildTaskCreationPolicyV1(settings, [{ id: settings.defaultInlineTaskTemplateId!, name: 'Default', kind: 'folder', path: 'Templates/Default.md' }], resolveEffectivePeriodicNoteConfig({ kind: 'daily', operon: buildOperonPeriodicNoteConfig('daily', settings), coreDailyNotes: { enabled: true, folder: 'Daily', format: 'YYYY-MM-DD', template: 'Templates/Daily.md' } }), resolveEffectivePeriodicNoteConfig({ kind: 'weekly', operon: buildOperonPeriodicNoteConfig('weekly', settings) }));
 return { settings, policy };
}
const ajv = new Ajv2020({ strict: false, validateFormats: false });
for (const file of readdirSync('contracts/agent-runtime/v1').filter(f => f.endsWith('.schema.json'))) ajv.addSchema(JSON.parse(readFileSync(`contracts/agent-runtime/v1/${file}`, 'utf8')));
for (const file of readdirSync('contracts/agent-runtime/extensions/task-workflows-v1').filter(f=>f.endsWith('.schema.json'))) ajv.addSchema(JSON.parse(readFileSync(`contracts/agent-runtime/extensions/task-workflows-v1/${file}`,'utf8')));
const document = JSON.parse(readFileSync('contracts/agent-runtime/extensions/task-creation-v1/creation.schema.json', 'utf8'));
ajv.addSchema(document);
export const validate = (name: string, value: unknown) => { const check = ajv.getSchema(`${document.$id}#/$defs/${name}`)!; const ok = check(value); if (!ok) console.error(check.errors); return ok; };
const preview: RoutedTaskCreationPreviewRequestV1 = { contractVersion: 1, kind: 'mutation-preview', requestId: 'create-test', clientInstanceId: 'test-client', idempotencyKey: 'creation-test-key', capability: 'tasks.create.routed.preview', mutationKind: 'task.create', authorization: { basis: 'user-explicit-request' }, spec: { operation: 'create', item: { itemRef: 'one', title: 'Review Q3', target: { mode: 'configured-default', representation: 'inline' }, template: { mode: 'configured' }, fields: [] } } };

test('policy projects actual weekly destination, templates, parent and filename rules without mutating settings', () => {
 const f = fixture(), before = structuredClone(f.settings);
 f.settings.fileTaskPipelineLocations = [{ pipelineId: 'work', folder: 'Work' }]; before.fileTaskPipelineLocations = structuredClone(f.settings.fileTaskPipelineLocations);
 const p = f.policy(); assert.equal(p.inline.saveMode, 'weekly-notes'); assert.equal(p.periodic.weekly.config?.folder, 'Weekly'); assert.equal(p.templates.defaultInlineId, f.settings.defaultInlineTaskTemplateId); assert.equal(p.periodic.daily.source, 'core-daily-notes');
 assert.equal(p.inline.parentInline, f.settings.inlineTaskParentInlineTargetMode); assert.equal(p.file.filenameFormat, f.settings.fileTaskFilenameRule.preset);
 assert.deepEqual(p.file.pipelineLocations, [{ pipelineId: 'work', folder: 'Work' }]); assert.ok(validate('policy', p));
 p.file.pipelineLocations[0].folder = 'Changed'; p.exclusions.push('Other'); assert.deepEqual(f.settings, before);
});
for (const mode of ['active-file','ask-every-time','specific-file','daily-notes','weekly-notes'] as const) test(`destination ${mode} requires no guessed active path`, () => {
 const f = fixture(); f.settings.inlineTaskSaveMode = mode; assert.equal(f.policy().inline.requiresExplicitTarget, mode === 'active-file' || mode === 'ask-every-time');
});
test('disabled weekly config is explained without falling back to daily', () => {
 const f = fixture(); f.settings.manageWeeklyNotesWithOperon = false; const p = f.policy(); assert.equal(p.inline.saveMode, 'weekly-notes'); assert.equal(p.periodic.weekly.available, false); assert.equal(p.periodic.weekly.reason, 'operon-disabled'); assert.equal(p.periodic.weekly.config, null); assert.ok(validate('policy',p));
});
test('read is detached, repeatable, bounded and fails closed on changed policy or lifecycle', async () => {
 const f = fixture(); let reads = 0, ready = true, drift = false;
 const runtime = createTaskCreationRuntimeV1({ ready: () => ready, admit: async () => ({ok:true}), readSource: async () => { reads++; if(drift && reads % 2 === 0) f.settings.inlineTaskHeading += 'x'; return f.policy(); } });
 const first = await runtime.readPolicy(request), second = await runtime.readPolicy(request);
 assert.equal(first.ok,true); assert.deepEqual(first,second); assert.ok(decodeTaskCreationPolicyResultV1(first).ok); assert.ok(validate('policyResult',first));
 drift=true; const changed=await runtime.readPolicy(request); assert.equal(changed.ok,false); if(!changed.ok) assert.equal(changed.error.code,'live-settling');
 ready=false; const count=reads; assert.equal((await runtime.readPolicy(request)).ok,false); assert.equal(reads,count);
});
test('read admission, exceptions and deadlines never produce successful policy', async () => {
 const f=fixture(); let calls=0;
 const denied=createTaskCreationRuntimeV1({ready:()=>true,admit:async()=>({ok:false}),readSource:async()=>{calls++;return f.policy();}});
 assert.equal((await denied.readPolicy(request)).ok,false); assert.equal(calls,0);
 const error=createTaskCreationRuntimeV1({ready:()=>true,admit:async()=>({ok:true}),readSource:async()=>{throw Error('failure');}}); assert.equal((await error.readPolicy(request)).ok,false);
 const expired=createTaskCreationRuntimeV1({ready:()=>true,admit:async()=>({ok:true}),readSource:async()=>f.policy()}); assert.equal((await expired.readPolicy(request,{deadlineAtMs:Date.now()-1})).ok,false);
});
test('strict request decoder and transport reject unknown keys and mismatched identity', () => {
 assert.ok(decodeTaskCreationPolicyRequestV1(request).ok); assert.ok(validate('policyRequest',request));
 for(const bad of [{...request,extra:true},{...request,consistency:'best-effort'},{...request,requestId:''},{...request,contractVersion:2}]) assert.equal(decodeTaskCreationPolicyRequestV1(bad).ok,false);
 const invocation={contractVersion:1,kind:'cli-invocation',requestId:request.requestId,command:'catalog',mode:'live',clientVersion:'1.2.0',compatibility:{contractVersion:1,runtimeApi:{min:1,max:1}},cliContract:{min:1,max:1},expectedVaultSha256:'a'.repeat(64),readinessTimeoutMs:15000,request};
 assert.ok(validateCliInvocationForTransportV1(invocation).ok); assert.ok(validate('cliInvocation',invocation)); assert.equal(validateCliInvocationForTransportV1({...invocation,requestId:'different'}).ok,false);
});
test('single create intents have strict target/template selection and cannot execute', () => {
 assert.ok(decodeRoutedTaskCreationPreviewV1(preview).ok); assert.ok(validate('previewRequest',preview));
 for (const bad of [{...preview,spec:{operation:'create',items:[preview.spec.item]}},{...preview,spec:{...preview.spec,item:{...preview.spec.item,description:'wrong'}}},{...preview,spec:{...preview.spec,item:{...preview.spec.item,template:{mode:'selected'}}}}]) assert.equal(decodeRoutedTaskCreationPreviewV1(bad).ok,false);
 const periodic=structuredClone(preview); periodic.spec.item.target={mode:'periodic-note',representation:'inline',periodicKind:'weekly',routeDate:'2026-11-09'};
 assert.ok(decodeRoutedTaskCreationPreviewV1(periodic).ok); assert.ok(validate('previewRequest',periodic)); periodic.spec.item.target.routeDate='2026-02-30'; assert.equal(decodeRoutedTaskCreationPreviewV1(periodic).ok,false);
 assert.equal(decodeRoutedTaskCreationApplyV1({}).ok,false);
 const caps=taskCreationAdvertisementsV1(true); assert.equal(caps[0].availability,'available'); assert.ok(caps.slice(1).every(c=>c.availability==='contract-only')); assert.equal(taskCreationAdvertisementsV1(false)[0].availability,'unavailable');
});
test('Developer API and transport boundary use the same policy; revocation blocks retained access',async()=>{
 const f=fixture(); let active=true, mutate=false;
 const runtime=createTaskCreationRuntimeV1({ready:()=>true,admit:async()=>({ok:true}),readSource:async()=>{ if(mutate) active=false; return f.policy(); }});
 const core={taskCreation:runtime,hasCapability:(id:string)=>id==='tasks.creation-policy.read'} as unknown as OperonAgentRuntimeCoreV1;
 const consumer={id:'test.consumer',name:'Consumer',version:'1.0.0',instanceEpoch:'one'};
 const options={isDesktopAvailable:()=>true,isHostVersionSupported:()=>true,lifecyclePhase:()=> 'ready',isCoreActive:(c:unknown)=>c===core,grantController:{verifyConsumer:()=>consumer,isConsumerCurrent:()=>true,evaluate:()=>({state:active?'active':'revoked'}),recordPending:()=>{throw Error('Unexpected grant write');}}} as unknown as TaskWorkflowDeveloperApiRuntimeOptionsV1;
 const access=()=>getTaskCreationDeveloperApiV1(core,{} as OperonDeveloperApiConsumerPluginV1,{contractVersion:1,runtimeApi:{min:1,max:1},requestedCapabilities:['tasks.creation-policy.read']},options);
 const a=access(); assert.ok(a.ok); if(!a.ok)return;
 assert.deepEqual(await a.api.creation.readPolicy(request),await runtime.readPolicy(request));
 mutate=true; assert.equal((await a.api.creation.readPolicy(request)).ok,false); assert.equal(access().ok,false);
 active=true; assert.equal(getTaskCreationDeveloperApiV1(core,{} as OperonDeveloperApiConsumerPluginV1,{contractVersion:1,runtimeApi:{min:1,max:1},requestedCapabilities:['tasks.create.routed.preview']},options).ok,false);
});

test('reserved plans bind policy and intent while old V1 apply rejects them', () => {
 const legacy = JSON.parse(readFileSync('scripts/agent-runtime/receipts/legacy-transaction-identifiers.json', 'utf8')).file.plan;
 const plan = { ...legacy, extension: 'task-creation-v1', capability: 'tasks.create.routed.preview', mutationKind: 'task.create', spec: { ...preview.spec, item: { ...preview.spec.item, target: { mode: 'configured-default', representation: 'file' } } }, policyRevision: 'a'.repeat(64), idempotencyKeyHash: sha256HexV1(preview.idempotencyKey), planHash: '' };
 const seal = () => { const {planHash: _hash,...body}=plan; plan.planHash=sha256HexV1(canonicalJsonV1(toJsonValueV1(body))); };
 seal();
 assert.ok(decodeRoutedTaskCreationPlanV1(plan).ok); assert.ok(validate('sealedPlan',plan));
 const result={contractVersion:1,requestId:'reserved-preview',kind:'mutation-preview-result',ok:true,warnings:[],plan};
 assert.ok(decodeRoutedTaskCreationPreviewResultV1(result).ok);assert.ok(validate('previewResult',result));
 const failed={contractVersion:1,requestId:'reserved-result',kind:'mutation-result',status:'failed',mutationMayHaveApplied:false,retryAllowed:false,groupResults:[],error:structuredErrorV1('capability-unavailable','Execution is contract-only.')};
 assert.ok(decodeRoutedTaskCreationMutationResultV1(failed).ok);assert.ok(validate('mutationResult',failed));
 const apply = { contractVersion:1,requestId:'reserved-apply',kind:'mutation-apply',authorization:preview.authorization,idempotencyKey:preview.idempotencyKey,acknowledgements:[],plan };
 assert.ok(decodeRoutedTaskCreationApplyV1(apply).ok); assert.ok(validate('applyRequest',apply)); assert.equal(decodeMutationApplyRequestV1(apply).ok,false);
 assert.equal(decodeRoutedTaskCreationApplyV1({...apply,idempotencyKey:'incorrect-test-key'}).ok,false);
 plan.policyRevision='b'.repeat(64); assert.equal(decodeRoutedTaskCreationApplyV1(apply).ok,false); seal(); assert.ok(decodeRoutedTaskCreationApplyV1(apply).ok);
 plan.spec=structuredClone(plan.spec); plan.spec.item.title='Changed'; assert.equal(decodeRoutedTaskCreationPlanV1(plan).ok,false);
});
test('facade advertises only the read implementation and lifecycle closes access', async () => {
 const lifecycle=new RuntimeLifecycleCoordinatorV1(); const release=lifecycle.beginSettling(); lifecycle.markReady(); release();
 const f=fixture(); const runtime=createTaskCreationRuntimeV1({ready:()=>lifecycle.getPhase()==='ready',admit:async()=>({ok:true}),readSource:async()=>f.policy()});
 const facade=createOperonAgentRuntimeFacadeV1(lifecycle,{taskCreation:runtime,persistencePhase:()=> 'idle',revision:()=>undefined});
 assert.ok(facade.hasCapability('tasks.creation-policy.read')); assert.equal(facade.hasCapability('tasks.create.routed.preview'),false); assert.equal(facade.hasCapability('tasks.create.routed.apply'),false);
 assert.deepEqual(await facade.taskCreation!.readPolicy(request),await runtime.readPolicy(request));
 const settling=lifecycle.beginSettling(); assert.equal(facade.hasCapability('tasks.creation-policy.read'),false); assert.equal((await facade.taskCreation!.readPolicy(request)).ok,false); settling();
});
test('policy result decoder rejects invalid representations, extra settings and oversized lists',async()=>{
 const f=fixture(), runtime=createTaskCreationRuntimeV1({ready:()=>true,admit:async()=>({ok:true}),readSource:async()=>f.policy()});
 const result=await runtime.readPolicy(request); assert.ok(result.ok); if(!result.ok)return;
 for(const policy of [{...result.policy,rawSettings:{}},{...result.policy,defaultRepresentation:'unknown'},{...result.policy,templates:{...result.policy.templates,candidates:Array(129).fill(result.policy.templates.candidates[0])}}]) assert.equal(decodeTaskCreationPolicyResultV1({...result,policy}).ok,false);
 const cyclic:Record<string,unknown>={...preview};cyclic.extra=cyclic;assert.equal(decodeRoutedTaskCreationPreviewV1(cyclic).ok,false);
 for(const name of Object.keys(document.$defs)) assert.ok(ajv.getSchema(`${document.$id}#/$defs/${name}`));
});

test('policy reports shared Daily fallback and the implicit template-folder exclusion', () => {
 const f=fixture();f.settings.inlineTaskSaveMode='daily-notes';f.settings.fileTaskTemplateFolder='Templates';
 const p=buildTaskCreationPolicyV1(f.settings,[],{available:false,reason:'core-daily-notes-unavailable'},{available:false,reason:'operon-disabled'});
 assert.equal(p.inline.configuredSaveMode,'daily-notes');assert.equal(p.inline.saveMode,'specific-file');assert.ok(p.exclusions.includes('Templates'));
 const invalid=buildTaskCreationPolicyV1(f.settings,[],{available:false,reason:'invalid-config',source:'operon'},{available:false,reason:'operon-disabled'});
 assert.equal(invalid.inline.saveMode,'daily-notes');assert.equal(invalid.periodic.daily.available,false);
});

test('published examples match the public schema and decoders', () => {
 const examples=JSON.parse(readFileSync('contracts/agent-runtime/extensions/task-creation-v1/examples.json','utf8'));
 assert.ok(validate('policyRequest',examples.policyRequest));assert.ok(decodeTaskCreationPolicyRequestV1(examples.policyRequest).ok);
 assert.ok(validate('previewRequest',examples.previewRequest));assert.ok(decodeRoutedTaskCreationPreviewV1(examples.previewRequest).ok);
});

test('reserved continuation requires a fresh seal and schema retains base create constraints', () => {
 const legacy=JSON.parse(readFileSync('scripts/agent-runtime/receipts/legacy-transaction-identifiers.json','utf8')).file.plan;
 const item={...legacy.spec.items[0],title:legacy.spec.items[0].description,template:{mode:'none'}};delete item.description;
 const plan={...legacy,extension:'task-creation-v1',capability:'tasks.create.routed.preview',policyRevision:'a'.repeat(64),spec:{operation:'create',item},planHash:''};
 const {planHash:_hash,...body}=plan;plan.planHash=sha256HexV1(canonicalJsonV1(toJsonValueV1(body)));
 const error=structuredErrorV1('capability-unavailable','Synthetic interruption');
 const partial={contractVersion:1,requestId:'continuation-test',kind:'mutation-result',status:'partial',mutationMayHaveApplied:true,retryAllowed:false,groupResults:[{groupId:'earlier-committed',status:'committed'},{groupId:plan.atomicGroups[0].groupId,status:'failed',error}],error,continuation:{originPlanHash:'b'.repeat(64),remainingGroupIds:plan.atomicGroups.map((g:{groupId:string})=>g.groupId),plan}};
 assert.ok(decodeRoutedTaskCreationMutationResultV1(partial).ok);
 partial.continuation.originPlanHash=plan.planHash;assert.equal(decodeRoutedTaskCreationMutationResultV1(partial).ok,false);
 const check=ajv.getSchema(`${document.$id}#/$defs/sealedPlan`)!;
 const {createEffects:_effects,...missing}=plan;assert.equal(check(missing),false);
 assert.equal(check({...plan,conversionEffect:{}}),false);assert.equal(check({...plan,updateBatchEffects:[]}),false);
});
test('oversized policy fails consistently before either channel returns it',async()=>{
 const f=fixture();const large=f.policy();large.exclusions=Array(512).fill('漢'.repeat(4096));
 const runtime=createTaskCreationRuntimeV1({ready:()=>true,admit:async()=>({ok:true}),readSource:async()=>structuredClone(large)});
 const result=await runtime.readPolicy(request);assert.equal(result.ok,false);if(!result.ok)assert.equal(result.error.code,'capability-unavailable');
});

test('reserved input supports each template selection and explicit inline/file/periodic targets', () => {
 for(const target of [{mode:'configured-default'},{mode:'exact-path',representation:'inline',filePath:'Inbox.md',lineNumber:0},{mode:'exact-path',representation:'file',filePath:'Tasks/Review Q3.md'},{mode:'periodic-note',representation:'inline',periodicKind:'daily',routeDate:'2026-12-31'}]) {
  for(const template of [{mode:'configured'},{mode:'none'},{mode:'selected',templateId:'folder-file-task-template:Templates/Task.md'}]) {
   const input={...preview,spec:{...preview.spec,item:{...preview.spec.item,title:'İnceleme 日本語',target,template}}};
   assert.ok(decodeRoutedTaskCreationPreviewV1(input).ok);assert.ok(validate('previewRequest',input));
  }
 }
});
