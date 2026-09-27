import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { computeSealedMutationPlanHashV1, sha256HexV1 } from '../../../src/agent-runtime/contracts/v1/canonical';
import type { MutationPreviewRequestV1, SealedMutationPlanV1, MutationResultV1 } from '../../../src/agent-runtime/contracts/v1/mutation';
import { decodeMutationApplyRequestV1 } from '../../../src/agent-runtime/contracts/v1/decode';
import { createCheckboxOwnershipRuntimeV1, type CheckboxOwnershipPortsV1 } from '../../../src/agent-runtime/extensions/checkbox-ownership-v1/gateway';
import { decodeCheckboxOwnershipApplyV1, decodeCheckboxOwnershipPreviewV1, checkboxOwnershipExecutionKeyV1, sealCheckboxOwnershipPlanV1 } from '../../../src/agent-runtime/extensions/checkbox-ownership-v1/decode';
import { CHECKBOX_OWNERSHIP_CAPABILITIES_V1, type CheckboxOwnershipSealedPlanV1 } from '../../../src/agent-runtime/extensions/checkbox-ownership-v1/contracts';
import { getCheckboxOwnershipDeveloperApiV1, type CheckboxOwnershipDeveloperOptionsV1 } from '../../../src/agent-runtime/extensions/checkbox-ownership-v1/developer-api';
import { DeveloperMutationSecurityPolicyV1 } from '../../../src/agent-runtime/developer-api/security';
import { IndexedDbDeveloperMutationRecoveryStoreV1 } from '../../../src/agent-runtime/developer-api/recovery-store';
import type { DeveloperApiGrantEvaluationV1 } from '../../../src/agent-runtime/developer-api/grants';
import type { OperonAgentRuntimeCoreV1 } from '../../../src/agent-runtime/runtime/types';
import type { OperonDeveloperApiConsumerPluginV1 } from '../../../src/agent-runtime/public/v1/developer-api';
import { FakeIndexedDbFactory } from '../developer-api/recovery-store.test';

const schemaSamples: { name: string; value: unknown }[] = [];
const sample = (name: string, value: unknown) => schemaSamples.push({ name, value: structuredClone(value) });
const legacy = JSON.parse(readFileSync('scripts/agent-runtime/receipts/legacy-transaction-identifiers.json','utf8')).inline.plan as SealedMutationPlanV1;
const key='checkbox-ownership-key';
const capability='tasks.create.contiguous.preview' as const;
function innerPlan(request?: MutationPreviewRequestV1): SealedMutationPlanV1 {
 const plan=structuredClone(legacy);
 plan.idempotencyKeyHash=sha256HexV1(request?.idempotencyKey ?? checkboxOwnershipExecutionKeyV1(capability,key));
 if(request) { plan.clientInstanceId=request.clientInstanceId; if(request.spec.operation !== 'create') throw new Error('Creation fixture only'); plan.spec=request.spec; }
 plan.planHash=computeSealedMutationPlanHashV1(plan);return plan;
}
function fixture(overrides: Partial<CheckboxOwnershipPortsV1>={}) {
 let writes=0;
 const runtime=createCheckboxOwnershipRuntimeV1({ready:()=>true,hasRecoveryEvidence:async()=>true,
 previewCore:async request=>({contractVersion:1,requestId:request.requestId,kind:'mutation-preview-result',ok:true,warnings:[],plan:innerPlan(request)}),
 applyCore:async request=>{writes++;return successful(request.requestId,request.plan)},
 previewAdopt:async()=>{throw new Error('unexpected adoption')},applyAdopt:async()=>{throw new Error('unexpected adoption')},filterQuery:async()=>{throw new Error('unused')},audit:async()=>{},...overrides});
 return {runtime,writes:()=>writes};
}
function successful(requestId:string,plan:SealedMutationPlanV1):MutationResultV1 {
 return {contractVersion:1,requestId,kind:'mutation-result',status:'applied',mutationMayHaveApplied:true,retryAllowed:false,groupResults:plan.atomicGroups.map(g=>({groupId:g.groupId,status:'committed'})),receipt:{contractVersion:1,vaultIdentityHash:'a'.repeat(64),clientInstanceId:plan.clientInstanceId,idempotencyKeyHash:plan.idempotencyKeyHash,planHash:plan.planHash,mutationKind:plan.mutationKind,targetDigest:plan.receiptTargetDigest,terminalOutcome:'applied',effectiveAt:plan.createdAt,completedAt:plan.createdAt,expiresAt:plan.expiresAt},postflight:{status:'verified',observedAt:plan.createdAt,contextRevision:plan.contextRevision}};
}
function applyInput(plan=sealCheckboxOwnershipPlanV1(innerPlan(),capability,key)) { return {contractVersion:1 as const,kind:'mutation-apply' as const,requestId:'ownership-apply',plan,idempotencyKey:key,authorization:{basis:'user-explicit-request' as const},acknowledgements:[]}; }
const previewInput={contractVersion:1,kind:'mutation-preview',requestId:'ownership-preview',clientInstanceId:'ownership-client',idempotencyKey:key,capability,mutationKind:'task.create',authorization:{basis:'user-explicit-request'},spec:legacy.spec};

test('extension seals immutable execution identity and old V1 rejects its envelope',async()=>{
 const f=fixture(), preview=await f.runtime.preview(previewInput);assert.ok(preview.ok,JSON.stringify(preview));if(!preview.ok)return;
 sample('mutation/previewRequest',previewInput);sample('mutation/previewResult',preview);sample('mutation/sealedPlan',preview.plan);
 const input=applyInput(preview.plan);sample('mutation/applyRequest',input);assert.equal(decodeCheckboxOwnershipApplyV1(input).ok,true);assert.equal(decodeMutationApplyRequestV1(input).ok,false);
 const result=await f.runtime.apply(input);sample('mutation/mutationResult',result);assert.equal(result.status,'applied');assert.equal(result.receipt?.planHash,preview.plan.planHash);assert.notEqual(preview.plan.planHash,preview.plan.executionPlan.planHash);assert.equal(result.receipt?.idempotencyKeyHash,sha256HexV1(key));
 const legacyInput={...input,plan:preview.plan.executionPlan};assert.equal(decodeMutationApplyRequestV1(legacyInput).ok,false,'same raw key cannot replay the inner operation');
});
test('tampered capability, inner seal, metadata, key, acknowledgements and extra fields fail closed',async()=>{
 const f=fixture(),good=applyInput();
 const cases=[{...good,idempotencyKey:'short'}, {...good,extra:true},{...good,plan:{...good.plan,capability:'tasks.convert.contiguous.preview'}},{...good,plan:{...good.plan,planHash:'0'.repeat(64)}},{...good,plan:{...good.plan,executionPlan:{...good.plan.executionPlan,planHash:'0'.repeat(64)}}},{...good,plan:{...good.plan,adoptionAfterDigest:'a'.repeat(64)}},{...good,acknowledgements:[{code:'unchecked',planHash:good.plan.executionPlan.planHash,targetDigest:good.plan.receiptTargetDigest}]}];
 for(const input of cases){assert.equal(decodeCheckboxOwnershipApplyV1(input).ok,false);assert.equal((await f.runtime.apply(input)).status,'failed');}
 assert.equal(f.writes(),0);
 const cycle:Record<string,unknown>={};cycle.self=cycle;assert.equal(decodeCheckboxOwnershipApplyV1(cycle).ok,false);
 assert.equal(decodeCheckboxOwnershipPreviewV1({...previewInput,policy:'contiguous'}).ok,false);
 assert.equal(decodeCheckboxOwnershipPreviewV1({...previewInput,mutationKind:'task.delete'}).ok,false);
});
test('apply snapshots caller input before awaiting audit',async()=>{
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve});const f=fixture({audit:async event=>{if(event==='apply-dispatched')await gate}}),input=applyInput(),hash=input.plan.planHash;
 const applying=f.runtime.apply(input);input.plan.planHash='f'.repeat(64);input.plan.executionPlan.planHash='0'.repeat(64);release();
 const result=await applying;assert.equal(result.status,'applied');assert.equal(result.receipt?.planHash,hash);
});
test('preview snapshots intent, and capabilities namespace identical raw idempotency keys',async()=>{
 const a=checkboxOwnershipExecutionKeyV1(capability,key),b=checkboxOwnershipExecutionKeyV1('tasks.adopt.contiguous.preview',key);assert.notEqual(a,b);assert.notEqual(a,key);
 const input=structuredClone(previewInput),decoded=decodeCheckboxOwnershipPreviewV1(input);assert.ok(decoded.ok);input.clientInstanceId='changed';if(decoded.ok)assert.equal(decoded.value.clientInstanceId,'ownership-client');
});

test('Developer API exact grants, opaque handles, recovery reference and transient admission preserve durable state',async()=>{
 const now=new Date('2026-07-24T10:00:00.000Z'),consumer={id:'checkbox.consumer',name:'Checkbox Consumer',version:'1.0.0',instanceEpoch:'epoch1'};
 let active=true,available=true,dispatches=0,failApply=true,recoveryHealthy=false,last:SealedMutationPlanV1|undefined;
 const f=fixture({hasRecoveryEvidence:async()=>recoveryHealthy,applyCore:async req=>{last=req.plan;dispatches++;if(failApply){failApply=false;throw new Error('lost completion')}return successful(req.requestId,req.plan)}});
 const core={checkboxOwnership:f.runtime,hasCapability:()=>available} as unknown as OperonAgentRuntimeCoreV1;
 const factory=new FakeIndexedDbFactory(),store=new IndexedDbDeveloperMutationRecoveryStoreV1({indexedDBFactory:factory as unknown as IDBFactory,now:()=>now.getTime()});
 const evaluate=():DeveloperApiGrantEvaluationV1=>({state:active?'active':'revoked',revision:1,grantedCapabilities:CHECKBOX_OWNERSHIP_CAPABILITIES_V1,effectiveCapabilities:active?CHECKBOX_OWNERSHIP_CAPABILITIES_V1:[],pendingCapabilities:[],reason:active?'active-grant':'revoked'} as DeveloperApiGrantEvaluationV1);
 const policy=new DeveloperMutationSecurityPolicyV1({consent:{requestConsent:async()=> 'approved'},isSessionCurrent:s=>s.consumerId===consumer.id&&s.instanceEpoch===consumer.instanceEpoch,isGrantCurrent:()=>active,now:()=>now});
 const options:CheckboxOwnershipDeveloperOptionsV1={isDesktopAvailable:()=>true,isHostVersionSupported:()=>true,lifecyclePhase:()=> 'ready',isCoreActive:c=>c===core,grantController:{verifyConsumer:()=>consumer,isConsumerCurrent:()=>true,evaluate,recordPending:()=>{}},mutationSecurityPolicy:policy,recoveryStore:store,now:()=>now};
 const access=()=>getCheckboxOwnershipDeveloperApiV1(core,{} as OperonDeveloperApiConsumerPluginV1,{contractVersion:1,runtimeApi:{min:1,max:1},requestedCapabilities:['tasks.create.contiguous.preview','tasks.create.contiguous.apply'] as const},options);
 const first=access();assert.ok(first.ok);if(!first.ok)return;
 const preview=await first.api.mutations.preview({capability,mutationKind:'task.create',spec:legacy.spec as CreateTaskSpecV1});assert.ok(preview.ok&&preview.plan);if(!preview.plan)return;
 sample('developer-api/previewResult',preview);sample('developer-api/planHandle',preview.plan);
 assert.equal('executionPlan' in preview.plan,false);assert.equal(Object.isFrozen(preview.plan),true);
 assert.equal((await first.api.mutations.apply({plan:structuredClone(preview.plan)})).status,'failed');
 const applied=await first.api.mutations.apply({plan:preview.plan});sample('developer-api/executionResult',applied);assert.equal(applied.status,'outcome-unknown');assert.equal(dispatches,1);assert.ok(last);
 const ref=preview.plan.recoveryRef;assert.equal((await store.get(consumer.id,ref))?.state,'dispatched');
 const recovered=await first.api.mutations.recover({plan:preview.plan});assert.equal(recovered.status,'outcome-unknown');assert.equal((await store.get(consumer.id,ref))?.state,'dispatched','temporary evidence failure must preserve recovery');assert.equal(dispatches,1);
 active=false;assert.equal((await first.api.mutations.recover({plan:preview.plan})).status,'failed');assert.equal(access().ok,false);active=true;
 const next=access();assert.ok(next.ok);if(!next.ok)return;
 const pending=await next.api.mutations.pendingRecoveries();sample('developer-api/pendingRecoveriesResult',pending);assert.ok(pending.ok);if(pending.ok)assert.equal(pending.recoveries.length,1);
 recoveryHealthy=true;
 const done=await next.api.mutations.recover({recoveryRef:ref});sample('developer-api/executionResult',done);assert.equal(done.status,'applied',JSON.stringify(done));assert.equal((await store.list(consumer.id)).length,0);
 assert.equal((await next.api.mutations.recover({recoveryRef:ref})).status,'already-applied');assert.equal(dispatches,2);
 available=false;assert.equal((await next.api.mutations.recover({recoveryRef:ref})).status,'failed');
});

function nativeConsumerContract(core:OperonAgentRuntimeCoreV1,plugin:OperonDeveloperApiConsumerPluginV1,options:CheckboxOwnershipDeveloperOptionsV1) {
 const result=getCheckboxOwnershipDeveloperApiV1(core,plugin,{contractVersion:1,runtimeApi:{min:1,max:1},requestedCapabilities:['tasks.filter-query.contiguous'] as const},options);
 if(!result.ok)return;
 // @ts-expect-error A filter-only consumer has no mutation method.
 void result.api.mutations.preview;
 void result.api.tasks.filterQuery;
}
void nativeConsumerContract;

import { prepareRuntimeTaskCreationV1, type RuntimeTaskCreationAdapterPortsV1 } from '../../../src/agent-runtime/runtime/task-creation-adapter';
import { DEFAULT_SETTINGS } from '../../../src/types/settings';
import type { CreateTaskSpecV1 } from '../../../src/agent-runtime/contracts/v1/mutation';
test('configured creation places multiple children after the block using parent indentation; exact and legacy positions remain',async()=>{
 const source='  - [ ] Parent {{operonId:: parent1}}\n        - [ ] Own\n\n- [ ] Detached',settings={...DEFAULT_SETTINGS,inlineTaskParentInlineTargetMode:'below-parent' as const};
 const parent={operonId:'parent1',duplicate:false,filePath:'Tasks.md',representation:'inline' as const,lineNumber:0,fieldValues:{operonId:'parent1'},tags:[]};
 const ports:RuntimeTaskCreationAdapterPortsV1={settings:()=>settings,listOperonIds:()=>new Set(['parent1']),listDependencyGraphTasks:()=>[],getExistingTask:id=>id==='parent1'?parent:null,readSource:async filePath=>({filePath,content:source}),resolveConfiguredInlineTarget:async()=>({filePath:'Tasks.md',placement:{kind:'after-line',lineNumber:0}}),resolveConfiguredFilePath:async()=> 'New.md',readTemplate:async()=>null,creationFieldCatalog:()=>[],resolveCoreTemplateVariables:text=>text,generateOperonId:()=> 'child01',now:()=> '2026-09-27T12:00:00'};
 const spec:CreateTaskSpecV1={operation:'create',items:[{itemRef:'child',description:'Child',parent:{kind:'existing',operonId:'parent1'},target:{representation:'inline',mode:'configured-default'},fields:[]}]};
 for(const mode of ['legacy','contiguous','exact'] as const){
  const result=await prepareRuntimeTaskCreationV1('placement-test',mode==='exact'?{...spec,items:spec.items.map(item=>({...item,target:{representation:'inline' as const,mode:'exact-path' as const,filePath:'Tasks.md',lineNumber:2}}))}:spec,{...ports,...(mode==='legacy'?{}:{checkboxOwnership:'contiguous'})});
  assert.ok(result.ok,JSON.stringify(result));if(!result.ok)continue;
  assert.equal(result.createEffects[0].locator.representation,'inline');const text=result.plan.sourceGroups[0].resultingContent;
  if(mode==='contiguous'){assert.ok(text.indexOf('Own')<text.indexOf('Child'));assert.match(text,/\n      - \[ \] Child/u)}
  if(mode==='legacy')assert.ok(text.indexOf('Child')<text.indexOf('Own'));
  if(mode==='exact')assert.match(text,/\n- \[ \] Child/u);
 }
 let n=0;
 const local:CreateTaskSpecV1={operation:'create',items:[{itemRef:'parent',description:'New parent',target:{representation:'inline',mode:'exact-path',filePath:'Tasks.md',lineNumber:2},fields:[]},...['one','two'].map(itemRef=>({itemRef,description:itemRef,parent:{kind:'created' as const,itemRef:'parent'},target:{representation:'inline' as const,mode:'configured-default' as const},fields:[]}))]};
 const result=await prepareRuntimeTaskCreationV1('local-parent',local,{...ports,checkboxOwnership:'contiguous',generateOperonId:()=> `child0${++n}`});assert.ok(result.ok,JSON.stringify(result));if(result.ok){const text=result.plan.sourceGroups[0].resultingContent;assert.match(text,/\n    - \[ \] one/u);assert.match(text,/\n    - \[ \] two/u);assert.ok(text.indexOf('New parent')<text.indexOf('one'));}
});

import { createOperonAgentRuntimeFacadeV1 } from '../../../src/agent-runtime/runtime/facade';
import { RuntimeLifecycleCoordinatorV1 } from '../../../src/agent-runtime/runtime/lifecycle';
import { decodeRuntimeHealthV1 } from '../../../src/agent-runtime/contracts/v1/decode';
import { decodeCheckboxOwnershipMutationResultV1 } from '../../../src/agent-runtime/extensions/checkbox-ownership-v1/decode';
test('extension discovery never leaks methods into frozen health DTO',async()=>{
 const lifecycle=new RuntimeLifecycleCoordinatorV1();const core=createOperonAgentRuntimeFacadeV1(lifecycle,{checkboxOwnership:fixture().runtime,checkboxOwnershipReady:()=>true,persistencePhase:()=> 'idle',revision:()=>undefined});
 const health=await core.system.health();assert.equal('checkboxOwnership' in health,false);assert.equal(decodeRuntimeHealthV1(health).ok,true,JSON.stringify(health));assert.equal(core.system.capabilities().filter(c=>c.id.includes('.contiguous')).length,9);
});
test('dispatch and terminal audit failures return valid uncertain Runtime results',async()=>{
 for(const ports of [{applyCore:async()=>{throw new Error('lost reply')}},{audit:async(event:string)=>{if(event==='apply-completed')throw new Error('audit')}}]){
  const f=fixture(ports);const result=await f.runtime.apply(applyInput());assert.equal(result.status,'outcome-unknown');sample('mutation/mutationResult',result);assert.equal(decodeCheckboxOwnershipMutationResultV1(result).ok,true,JSON.stringify(result));
 }
});

test('real Runtime and Developer API envelopes satisfy the new JSON schema entrypoints',()=>{
 assert.ok(schemaSamples.length>=10);
 const script=`import Ajv from 'ajv/dist/2020.js';import fs from 'node:fs';
 const ajv=new Ajv({strict:true,strictSchema:false,strictTypes:false,strictRequired:false,validateFormats:false});
 for(const dir of ['contracts/agent-runtime/v1','contracts/agent-runtime/extensions/task-workflows-v1','contracts/agent-runtime/extensions/checkbox-ownership-v1'])for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.schema.json')))ajv.addSchema(JSON.parse(fs.readFileSync(dir+'/'+f,'utf8')));
 for(const {name,value} of JSON.parse(fs.readFileSync(0,'utf8'))){const [file,def]=name.split('/');const check=ajv.getSchema('urn:operon:schema:runtime:v1:extension:checkbox-ownership:'+file+'#/$defs/'+def);if(!check(value))throw new Error(name+': '+JSON.stringify(check.errors));}
 `;
 execFileSync(process.execPath,['--input-type=module','-e',script],{input:JSON.stringify(schemaSamples),encoding:'utf8',maxBuffer:1024*1024});
});
